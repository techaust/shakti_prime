import {
  newId,
  type PlaybookAudience,
  type PlaybookDirectiveDto,
  type PlaybookDirectiveType,
  type Principal,
} from '@shakti/contracts';
import {
  asMigrator,
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import type { output, ZodType } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { Command } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import {
  approvePlaybookDirective,
  draftPlaybookDirective,
  editPlaybookDirective,
  resolvePlaybookConflict,
  retirePlaybookDirective,
} from '../../src/commands/knowledge/playbook';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';

// The Playbook's commands on real Postgres (docs/03-roadmap-appendix/phase2.md §5.4, PRD AI-01).
// The conflict check is the platform's job; here its outcome is written as the table owner, as
// its definer will, so each command is tested on its own. Every text is synthetic.

afterAll(closeDb);

/** A word no earlier run wrote, so this run's rows are told from earlier ones. */
const RUN = `run${Date.now().toString(36)}`;

let executive: Principal;
let gm: Principal;
let gmOne: Principal;
let accounts: Principal;
let caller: Principal;

beforeAll(async () => {
  executive = await createTestPrincipal('executive');
  gm = await createTestPrincipal('general_manager');
  gmOne = await createTestPrincipal('general_manager', [1]);
  accounts = await createTestPrincipal('accounts', [1]);
  caller = await createTestPrincipal('tele_caller_cc', [1]);
});

const run = <I extends ZodType, O extends ZodType>(
  principal: Principal,
  command: Command<I, O>,
  input: unknown,
): Promise<output<O>> =>
  asPrincipal(principal, (context) => runCommand(command, { context, audit, outbox }, input));

/** One principal acting in fewer companies than it holds. */
const actingIn = (principal: Principal, entityIds: number[]): Principal => ({
  ...principal,
  entityIds,
});

const draft = (
  principal: Principal,
  over: {
    entityId?: number;
    wholeGroup?: boolean;
    type?: PlaybookDirectiveType;
    audience?: PlaybookAudience;
    text?: string;
    sourceFileId?: string | null;
  } = {},
) =>
  run(principal, draftPlaybookDirective, {
    entityId: over.entityId ?? 1,
    wholeGroup: over.wholeGroup ?? false,
    type: over.type ?? 'faq',
    audience: over.audience ?? 'staff',
    title: `Synthetic rule ${RUN}`,
    text: over.text ?? `Synthetic directive text ${RUN} ${newId()}`,
    sourceFileId: over.sourceFileId ?? null,
  });

/** What the conflict check records once it has run on a draft: clear, or with open pairs. */
async function checked(
  directiveId: string,
  pairs: { otherId: string; label: 'conflict' | 'overlap' | 'none' }[] = [],
): Promise<string[]> {
  return asMigrator(async (m) => {
    const ids: string[] = [];
    for (const pair of pairs) {
      const id = newId();
      ids.push(id);
      await m`insert into playbook_conflict_checks (id, entity_id, directive_id, other_id, distance, label, reason)
              select ${id}, d.entity_id, d.id, ${pair.otherId}, 0.1, ${pair.label}, 'synthetic reason'
                from playbook_directives d where d.id = ${directiveId}`;
    }
    const open = pairs.filter((p) => p.label !== 'none').map((p) => p.otherId);
    await m`update playbook_directives
               set checked_at = now(), conflicts_with = ${open}::uuid[]
             where id = ${directiveId}`;
    return ids;
  });
}

/** A draft approved by the Executive, its check clear. */
async function approved(over: Parameters<typeof draft>[1] = {}): Promise<PlaybookDirectiveDto> {
  const row = await draft(executive, over);
  await checked(row.id);
  return run(executive, approvePlaybookDirective, {
    entityId: over.entityId ?? 1,
    directiveId: row.id,
  });
}

async function eventsOf(directiveId: string) {
  return asOutboxPublisher(
    (p) => p<{ type: string; entity_id: number; payload_json: Record<string, unknown> }[]>`
      select type, entity_id, payload_json from outbox_events
       where aggregate_id = ${directiveId} order by sequence`,
  );
}

async function auditOf(directiveId: string) {
  return asMigrator(
    (m) => m<{ command: string; outcome: string }[]>`
      select command, outcome from audit_logs where aggregate_id = ${directiveId} order by created_at`,
  );
}

describe('knowledge.playbook.draft', () => {
  it('is refused without knowledge.playbook.draft, and to every agent', async () => {
    await expect(draft(caller)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(draft(accounts)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(draft(principalFor('agent:copilot', [1]))).rejects.toMatchObject({
      code: 'forbidden',
      details: { reason: 'people_only' },
    });
  });

  it('is refused for a company outside the request, and the whole group outside every company', async () => {
    await expect(draft(gmOne, { entityId: 2 })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(draft(gmOne, { wholeGroup: true })).rejects.toMatchObject({
      code: 'forbidden',
      details: { reason: 'playbook_needs_all_companies' },
    });
  });

  it('writes a draft for the company, unchecked, audited, with its event', async () => {
    const row = await draft(gm, { type: 'policy', audience: 'management' });
    expect(row).toMatchObject({
      entityId: 1,
      type: 'policy',
      audience: 'management',
      state: 'draft',
      approvedBy: null,
      conflictsWith: [],
      checkedAt: null,
      createdBy: gm.id,
    });
    expect(await eventsOf(row.id)).toEqual([
      {
        type: 'knowledge.playbook.changed',
        entity_id: 1,
        payload_json: {
          directiveEntityId: 1,
          change: 'drafted',
          state: 'draft',
          recheck: true,
          v: 1,
        },
      },
    ]);
    expect(await auditOf(row.id)).toEqual([{ command: 'knowledge.playbook.draft', outcome: 'ok' }]);
    const group = await draft(executive, { wholeGroup: true });
    expect(group.entityId).toBeNull();
  });

  it('names only a vault file the drafter reads as its source', async () => {
    await expect(draft(gm, { sourceFileId: newId() })).rejects.toMatchObject({
      code: 'not_found',
      details: { reason: 'playbook_source_missing' },
    });
  });
});

describe('knowledge.playbook.edit', () => {
  it('is refused without the grant, outside the request and to an agent', async () => {
    const row = await draft(gm);
    const edit = (p: Principal, entityId = 1) =>
      run(p, editPlaybookDirective, {
        entityId,
        directiveId: row.id,
        type: 'faq',
        audience: 'staff',
        title: 'Synthetic rule edited',
        text: 'Synthetic text edited',
      });
    await expect(edit(caller)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(edit(principalFor('agent:chief', [1]))).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(edit(gmOne, 2)).rejects.toMatchObject({ code: 'forbidden' });
    // A directive of company 1 is not found from a request for company 2.
    await expect(edit(actingIn(gm, [2]), 2)).rejects.toMatchObject({
      code: 'not_found',
      details: { reason: 'playbook_directive_missing' },
    });
  });

  it('rewords a draft and clears its check; an approved directive is not reworded', async () => {
    const row = await draft(gm);
    await checked(row.id, [{ otherId: (await approved()).id, label: 'overlap' }]);
    const edited = await run(gm, editPlaybookDirective, {
      entityId: 1,
      directiveId: row.id,
      type: 'sop',
      audience: 'customer',
      title: 'Synthetic rule edited',
      text: `Synthetic text edited ${RUN}`,
    });
    expect(edited).toMatchObject({
      type: 'sop',
      audience: 'customer',
      state: 'draft',
      checkedAt: null,
      conflictsWith: [],
    });
    expect((await eventsOf(row.id)).at(-1)?.payload_json).toMatchObject({
      change: 'edited',
      recheck: true,
    });
    const done = await approved();
    await expect(
      run(gm, editPlaybookDirective, {
        entityId: 1,
        directiveId: done.id,
        type: 'faq',
        audience: 'staff',
        title: 'Synthetic rule edited',
        text: 'Synthetic text edited',
      }),
    ).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'playbook_directive_transition_not_allowed' },
    });
  });
});

describe('knowledge.playbook.approve', () => {
  it('is the Executive’s alone: a General Manager, an agent and another company are refused', async () => {
    const row = await draft(gm);
    await checked(row.id);
    const approve = (p: Principal, entityId = 1) =>
      run(p, approvePlaybookDirective, { entityId, directiveId: row.id });
    await expect(approve(gm)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(approve(principalFor('agent:copilot', [1]))).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(approve(actingIn(executive, [2]), 2)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(approve(actingIn(executive, [1]), 2)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('waits for the conflict check, and for a check newer than the last approval of its kind', async () => {
    const row = await draft(gm, { type: 'tone' });
    await expect(
      run(executive, approvePlaybookDirective, { entityId: 1, directiveId: row.id }),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'playbook_check_pending' } });
    await checked(row.id);
    // A directive of the same kind for the same company approved after the check ran.
    await approved({ type: 'tone' });
    await expect(
      run(executive, approvePlaybookDirective, { entityId: 1, directiveId: row.id }),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'playbook_check_pending' } });
  });

  it('is refused while a conflict or overlap is open (AI-01)', async () => {
    const other = await approved({ type: 'target' });
    const row = await draft(gm, { type: 'target' });
    await checked(row.id, [{ otherId: other.id, label: 'conflict' }]);
    await expect(
      run(executive, approvePlaybookDirective, { entityId: 1, directiveId: row.id }),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'playbook_conflict_open' } });
  });

  it('approves a checked draft with nothing open, audited, with its event', async () => {
    const row = await draft(gm, { type: 'priority' });
    const other = await approved({ type: 'priority' });
    await checked(row.id, [{ otherId: other.id, label: 'none' }]);
    const done = await run(executive, approvePlaybookDirective, {
      entityId: 1,
      directiveId: row.id,
    });
    expect(done).toMatchObject({ state: 'approved', approvedBy: executive.id, conflictsWith: [] });
    expect(done.approvedAt).not.toBeNull();
    expect((await eventsOf(row.id)).at(-1)?.payload_json).toMatchObject({
      change: 'approved',
      state: 'approved',
      recheck: false,
    });
    expect((await auditOf(row.id)).map((a) => a.command)).toContain('knowledge.playbook.approve');
  });

  it('refuses in the database what the command would refuse', async () => {
    const row = await draft(gm);
    // The approver writing the row directly, past the command: the guard refuses an unchecked draft.
    await expect(
      asPrincipal(executive, ({ tx }) =>
        tx.execute(
          sql`update playbook_directives
                 set state = 'approved', approved_by = ${executive.id}, approved_at = now()
               where id = ${row.id}`,
        ),
      ),
    ).rejects.toThrow();
  });
});

describe('knowledge.playbook.retire', () => {
  it('is refused without the grant, to an agent and for another company; an approved one is the Executive’s', async () => {
    const row = await draft(gm);
    const retire = (p: Principal, directiveId: string, entityId = 1) =>
      run(p, retirePlaybookDirective, { entityId, directiveId, reason: 'synthetic reason' });
    await expect(retire(caller, row.id)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(retire(principalFor('agent:copilot', [1]), row.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(retire(gmOne, row.id, 2)).rejects.toMatchObject({ code: 'forbidden' });
    const done = await approved();
    await expect(retire(gm, done.id)).rejects.toMatchObject({ code: 'forbidden' });
    expect(await retire(gm, row.id)).toMatchObject({
      state: 'retired',
      retiredReason: 'synthetic reason',
    });
  });

  it('retires an approved directive and settles the open conflicts naming it', async () => {
    const other = await approved({ type: 'policy' });
    const row = await draft(gm, { type: 'policy' });
    const [pair] = await checked(row.id, [{ otherId: other.id, label: 'conflict' }]);
    const retired = await run(executive, retirePlaybookDirective, {
      entityId: 1,
      directiveId: other.id,
      reason: 'synthetic reason',
    });
    expect(retired).toMatchObject({ state: 'retired' });
    const [after] = await asMigrator(
      (m) => m<{ resolution: string | null; conflicts_with: string[] }[]>`
        select c.resolution, d.conflicts_with
          from playbook_conflict_checks c join playbook_directives d on d.id = c.directive_id
         where c.id = ${pair ?? ''}`,
    );
    expect(after).toEqual({ resolution: 'other_retired', conflicts_with: [] });
    // Nothing more happens to a retired directive.
    await expect(
      run(executive, retirePlaybookDirective, {
        entityId: 1,
        directiveId: other.id,
        reason: 'synthetic reason',
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('knowledge.playbook.resolve_conflict', () => {
  async function openPair() {
    const other = await approved({ type: 'sop' });
    const row = await draft(gm, { type: 'sop' });
    const [checkId] = await checked(row.id, [{ otherId: other.id, label: 'overlap' }]);
    if (checkId === undefined) throw new Error('no pair written');
    return { other, row, checkId };
  }

  it('is the Executive’s alone, and refused from another company', async () => {
    const { checkId } = await openPair();
    const resolve = (p: Principal, entityId = 1) =>
      run(p, resolvePlaybookConflict, {
        entityId,
        checkId,
        resolution: 'not_a_conflict',
        note: 'synthetic note',
      });
    await expect(resolve(gm)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(resolve(principalFor('agent:copilot', [1]))).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(resolve(actingIn(executive, [1]), 2)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(resolve(actingIn(executive, [2]), 2)).rejects.toMatchObject({
      code: 'not_found',
      details: { reason: 'playbook_conflict_missing' },
    });
  });

  it('marks a pair not a conflict, after which the draft can be approved', async () => {
    const { row, checkId } = await openPair();
    const resolved = await run(executive, resolvePlaybookConflict, {
      entityId: 1,
      checkId,
      resolution: 'not_a_conflict',
      note: 'synthetic note',
    });
    expect(resolved).toMatchObject({
      resolution: 'not_a_conflict',
      resolutionNote: 'synthetic note',
      resolvedBy: executive.id,
    });
    await expect(
      run(executive, resolvePlaybookConflict, {
        entityId: 1,
        checkId,
        resolution: 'not_a_conflict',
        note: 'synthetic note',
      }),
    ).rejects.toMatchObject({ details: { reason: 'playbook_conflict_resolved' } });
    expect(
      await run(executive, approvePlaybookDirective, { entityId: 1, directiveId: row.id }),
    ).toMatchObject({ state: 'approved' });
  });

  it('settles a pair by retiring the other directive', async () => {
    const { other, row, checkId } = await openPair();
    const resolved = await run(executive, resolvePlaybookConflict, {
      entityId: 1,
      checkId,
      resolution: 'other_retired',
      note: 'synthetic note',
    });
    expect(resolved).toMatchObject({ resolution: 'other_retired' });
    const [gone] = await asMigrator(
      (m) => m<{ state: string; retired_reason: string }[]>`
        select state, retired_reason from playbook_directives where id = ${other.id}`,
    );
    expect(gone).toEqual({ state: 'retired', retired_reason: 'synthetic note' });
    expect((await eventsOf(row.id)).at(-1)?.payload_json).toMatchObject({
      change: 'conflict_resolved',
    });
  });
});
