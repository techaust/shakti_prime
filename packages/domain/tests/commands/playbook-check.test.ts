import {
  newId,
  SYSTEM_MATRIX,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type PlaybookDirectiveType,
  type Principal,
} from '@shakti/contracts';
import { asMigrator, asPrincipal, closeDb, createTestPrincipal } from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import type { output, ZodType } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENT_DEFAULTS } from '../../src/ai/agent-defaults';
import { createAiProvider, type AiProvider } from '../../src/ai/provider';
import {
  fakeEmbedding,
  fakeModelTransport,
  fakeReply,
  ModelCallError,
  type FakeModelTransport,
} from '../../src/ai/transport';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { Command } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import {
  approvePlaybookDirective,
  draftPlaybookDirective,
  editPlaybookDirective,
  resolvePlaybookConflict,
} from '../../src/commands/knowledge/playbook';
import {
  playbookCandidates,
  playbookCheckTargets,
  recordPlaybookCheck,
} from '../../src/commands/knowledge/playbook-check';
import { checkPlaybook, directiveText } from '../../src/knowledge/playbook-check';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { memoryKeyValue } from '../../src/ports/key-value';
import { memoryLogger } from '../../src/ports/logger';

// The Playbook's conflict check on real Postgres (docs/03-roadmap-appendix/phase2.md §5.4): the
// candidates are found by type, company and the fake embeddings' distance (texts that share words
// lie close); the fake model labels each pair. Every text is synthetic, and each test uses words of
// its own so no other run's directive comes near.

afterAll(closeDb);

let executive: Principal;
let gm: Principal;

beforeAll(async () => {
  executive = await createTestPrincipal('executive');
  gm = await createTestPrincipal('general_manager');
});

const workers = (entityId: number): Principal => ({
  id: SYSTEM_WORKERS_PRINCIPAL_ID,
  kind: 'system',
  roleKey: 'system:workers',
  entityIds: [entityId],
  permissions: [...SYSTEM_MATRIX['system:workers']],
});

const run = <I extends ZodType, O extends ZodType>(
  principal: Principal,
  command: Command<I, O>,
  input: unknown,
): Promise<output<O>> =>
  asPrincipal(principal, (context) => runCommand(command, { context, audit, outbox }, input));

/** Words no other test or run writes. */
const words = (n = 6): string =>
  Array.from({ length: n }, () => `w${Math.random().toString(36).slice(2, 10)}`).join(' ');

function provider(options: { claude?: boolean; voyage?: boolean; replies?: string[] } = {}): {
  ai: AiProvider;
  transport: FakeModelTransport;
} {
  const transport = fakeModelTransport((options.replies ?? ['']).map((r) => fakeReply(r)));
  return {
    transport,
    ai: createAiProvider({
      claude: options.claude === false ? undefined : transport,
      voyage: options.voyage === false ? undefined : transport,
      keyValue: memoryKeyValue(),
      logger: memoryLogger(),
    }),
  };
}

const label = (
  l: 'conflict' | 'overlap' | 'none',
  reason = 'Both rules set the same visit hours.',
) => JSON.stringify({ label: l, reason });

/** The conflict check as the worker runs it for a change of `directiveId`. */
const check = (
  directiveId: string,
  ai: AiProvider,
  change: 'drafted' | 'edited' | 'approved' = 'drafted',
  entityId = 1,
) =>
  checkPlaybook(
    {
      entityId,
      aggregateId: directiveId,
      payload: { v: 1, change, recheck: change !== 'approved' },
    },
    { principal: workers(entityId), provider: ai, requestId: newId(), hosted: false },
  );

async function draft(
  text: string,
  over: { type?: PlaybookDirectiveType; entityId?: number; wholeGroup?: boolean } = {},
) {
  return run(executive, draftPlaybookDirective, {
    entityId: over.entityId ?? 1,
    wholeGroup: over.wholeGroup ?? false,
    type: over.type ?? 'policy',
    audience: 'staff',
    title: 'Synthetic check rule',
    text,
  });
}

/**
 * An approved directive with its embedding: drafted, checked (any near directive labelled `none`)
 * and approved.
 */
async function approved(text: string, over: Parameters<typeof draft>[1] = {}) {
  const row = await draft(text, over);
  await check(
    row.id,
    provider({ replies: [label('none', 'Different cases.')] }).ai,
    'drafted',
    over.entityId ?? 1,
  );
  return run(executive, approvePlaybookDirective, {
    entityId: over.entityId ?? 1,
    directiveId: row.id,
  });
}

async function directive(id: string) {
  const [row] = await asMigrator(
    (m) => m<{ checked: boolean; conflicts_with: string[]; embedded: boolean }[]>`
      select checked_at is not null as checked, conflicts_with, embedding is not null as embedded
        from playbook_directives where id = ${id}`,
  );
  return row;
}

async function pairs(id: string) {
  return asMigrator(
    (m) => m<{ id: string; other_id: string; label: string | null; reason: string | null }[]>`
      select id, other_id, label, reason from playbook_conflict_checks where directive_id = ${id}`,
  );
}

describe('the conflict check', () => {
  it('flags a close approved directive of the same type, and the flag blocks approval (AI-01)', async () => {
    const shared = words();
    const other = await approved(`${shared} ${words(1)}`);
    const row = await draft(shared);
    const { ai, transport } = provider({ replies: [label('conflict')] });
    expect(await check(row.id, ai)).toEqual({ checked: 1, waiting: 0 });
    expect(await directive(row.id)).toEqual({
      checked: true,
      conflicts_with: [other.id],
      embedded: true,
    });
    expect(await pairs(row.id)).toMatchObject([
      { other_id: other.id, label: 'conflict', reason: 'Both rules set the same visit hours.' },
    ]);
    // The model labelled with Haiku 5.5, at its own effort, the rules as labelled data.
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]).toMatchObject({
      model: AGENT_DEFAULTS.playbook.labelModel,
      effort: 'low',
    });
    expect(transport.requests[0]?.user).toContain(shared);
    await expect(
      run(executive, approvePlaybookDirective, { entityId: 1, directiveId: row.id }),
    ).rejects.toMatchObject({ details: { reason: 'playbook_conflict_open' } });
  });

  it('leaves a pair labelled none open to approval', async () => {
    const shared = words();
    await approved(`${shared} ${words(1)}`, { type: 'faq' });
    const row = await draft(shared, { type: 'faq' });
    await check(row.id, provider({ replies: [label('none', 'They cover different visits.')] }).ai);
    expect((await directive(row.id))?.conflicts_with).toEqual([]);
    expect(
      await run(executive, approvePlaybookDirective, { entityId: 1, directiveId: row.id }),
    ).toMatchObject({ state: 'approved' });
  });

  it('compares only the same type and overlapping companies; the group overlaps every company', async () => {
    const shared = words();
    await approved(`${shared} ${words(1)}`, { type: 'tone' });
    await approved(`${shared} ${words(1)}`, { type: 'sop', entityId: 2 });
    const group = await approved(`${shared} ${words(1)}`, { type: 'sop', wholeGroup: true });
    const row = await draft(shared, { type: 'sop' });
    await check(row.id, provider({ replies: [label('overlap')] }).ai);
    expect((await pairs(row.id)).map((p) => p.other_id)).toEqual([group.id]);
  });

  it('records a pair the model could not label as open, which the Executive may decide', async () => {
    const shared = words();
    await approved(`${shared} ${words(1)}`, { type: 'target' });
    const row = await draft(shared, { type: 'target' });
    // No model key, and then an answer that cannot be read: both leave the pair unlabelled.
    await check(row.id, provider({ claude: false }).ai);
    const [pair] = await pairs(row.id);
    expect(pair).toMatchObject({ label: null, reason: null });
    await expect(
      run(executive, approvePlaybookDirective, { entityId: 1, directiveId: row.id }),
    ).rejects.toMatchObject({ details: { reason: 'playbook_conflict_open' } });
    await run(executive, resolvePlaybookConflict, {
      entityId: 1,
      checkId: pair?.id,
      resolution: 'not_a_conflict',
      note: 'Read both; they agree.',
    });
    expect(
      await run(executive, approvePlaybookDirective, { entityId: 1, directiveId: row.id }),
    ).toMatchObject({ state: 'approved' });

    const unread = await draft(`${shared} ${words(1)}`, { type: 'target' });
    await check(unread.id, provider({ replies: ['not an answer'] }).ai);
    expect((await pairs(unread.id)).every((p) => p.label === null)).toBe(true);
  });

  it('leaves a draft unchecked, so it waits, while no embedding can be made', async () => {
    const row = await draft(words());
    expect(await check(row.id, provider({ voyage: false }).ai)).toEqual({
      checked: 0,
      waiting: 1,
    });
    expect((await directive(row.id))?.checked).toBe(false);
    await expect(
      run(executive, approvePlaybookDirective, { entityId: 1, directiveId: row.id }),
    ).rejects.toMatchObject({ details: { reason: 'playbook_check_pending' } });
  });

  it('checks again after an edit, dropping the old pairs and their resolutions', async () => {
    const shared = words();
    await approved(`${shared} ${words(1)}`, { type: 'priority' });
    const row = await draft(shared, { type: 'priority' });
    await check(row.id, provider({ replies: [label('conflict')] }).ai);
    const fresh = words();
    await run(gm, editPlaybookDirective, {
      entityId: 1,
      directiveId: row.id,
      type: 'priority',
      audience: 'staff',
      title: 'Synthetic check rule',
      text: fresh,
    });
    expect(await directive(row.id)).toMatchObject({ checked: false, embedded: false });
    await check(row.id, provider().ai, 'edited');
    expect(await pairs(row.id)).toEqual([]);
    expect(await directive(row.id)).toMatchObject({ checked: true, conflicts_with: [] });
  });

  it('rechecks the drafts an approval made stale, keeping a resolved pair', async () => {
    const shared = words();
    const first = await approved(`${shared} ${words(1)}`, { type: 'faq' });
    const row = await draft(shared, { type: 'faq' });
    await check(row.id, provider({ replies: [label('overlap')] }).ai);
    const [pair] = await pairs(row.id);
    await run(executive, resolvePlaybookConflict, {
      entityId: 1,
      checkId: pair?.id,
      resolution: 'not_a_conflict',
      note: 'They say it differently on purpose.',
    });
    // A second directive near the draft is approved: the draft's check is now stale.
    const second = await approved(`${shared} ${words(1)}`, { type: 'faq' });
    await expect(
      run(executive, approvePlaybookDirective, { entityId: 1, directiveId: row.id }),
    ).rejects.toMatchObject({ details: { reason: 'playbook_check_pending' } });
    await check(second.id, provider({ replies: [label('conflict')] }).ai, 'approved');
    const after = await pairs(row.id);
    expect(after.find((p) => p.other_id === first.id)).toMatchObject({ id: pair?.id });
    expect(after.find((p) => p.other_id === second.id)).toMatchObject({ label: 'conflict' });
    expect((await directive(row.id))?.conflicts_with).toEqual([second.id]);
  });

  it('compares a draft with a rule approved while its check was running (review finding 1)', async () => {
    const shared = words();
    const row = await draft(shared, { type: 'tone' });
    // The check reads its candidates: nothing approved is near yet.
    const [target] = await asPrincipal(workers(1), ({ tx }) => playbookCheckTargets(tx, row.id));
    if (target === undefined) throw new Error('no target');
    const embedding = fakeEmbedding(directiveText(target));
    const read = await asPrincipal(workers(1), ({ tx }) =>
      playbookCandidates(tx, row.id, embedding, 0.2, 5),
    );
    expect(read.candidates).toEqual([]);
    // Y, close to the draft, is approved before the check records what it read.
    const y = await approved(`${shared} ${words(1)}`, { type: 'tone' });
    const recorded = await run(workers(1), recordPlaybookCheck, {
      entityId: 1,
      directiveId: row.id,
      wordingSha256: target.wordingSha256,
      checkedAsOf: read.readAt,
      embedding,
      pairs: [],
    });
    expect(recorded).toMatchObject({ skipped: false, open: 0 });
    // The check is older than Y's approval, so the draft waits for a check against Y.
    await expect(
      run(executive, approvePlaybookDirective, { entityId: 1, directiveId: row.id }),
    ).rejects.toMatchObject({ details: { reason: 'playbook_check_pending' } });
    // Y's own event checks the draft again, against Y.
    await check(y.id, provider({ replies: [label('conflict')] }).ai, 'approved');
    expect((await pairs(row.id)).map((p) => p.other_id)).toEqual([y.id]);
    await expect(
      run(executive, approvePlaybookDirective, { entityId: 1, directiveId: row.id }),
    ).rejects.toMatchObject({ details: { reason: 'playbook_conflict_open' } });
    // A late record of the older check changes nothing now.
    const late = await run(workers(1), recordPlaybookCheck, {
      entityId: 1,
      directiveId: row.id,
      wordingSha256: target.wordingSha256,
      checkedAsOf: read.readAt,
      embedding,
      pairs: [],
    });
    expect(late).toMatchObject({ skipped: true });
    expect((await pairs(row.id)).map((p) => p.other_id)).toEqual([y.id]);
  });

  it('never lets two drafts of one type approved one after the other miss each other', async () => {
    const shared = words();
    const first = await draft(`${shared} ${words(1)}`, { type: 'target' });
    const second = await draft(`${shared} ${words(1)}`, { type: 'target' });
    const clear = provider({ replies: [label('none', 'Different cases.')] }).ai;
    await check(first.id, clear);
    await check(second.id, clear);
    await run(executive, approvePlaybookDirective, { entityId: 1, directiveId: first.id });
    // The second was checked before the first was approved: it waits for a check against it.
    await expect(
      run(executive, approvePlaybookDirective, { entityId: 1, directiveId: second.id }),
    ).rejects.toMatchObject({ details: { reason: 'playbook_check_pending' } });
    await check(first.id, provider({ replies: [label('overlap')] }).ai, 'approved');
    expect((await pairs(second.id)).map((p) => p.other_id)).toEqual([first.id]);
  });

  it('records a pair unlabelled when the label call fails, and goes on (finding 6)', async () => {
    const shared = words();
    await approved(`${shared} ${words(1)}`, { type: 'faq' });
    const row = await draft(shared, { type: 'faq' });
    const transport = fakeModelTransport([new ModelCallError('http', { status: 400 })]);
    const ai = createAiProvider({
      claude: transport,
      voyage: transport,
      keyValue: memoryKeyValue(),
      logger: memoryLogger(),
    });
    expect(await check(row.id, ai)).toEqual({ checked: 1, waiting: 0 });
    expect(await pairs(row.id)).toMatchObject([{ label: null, reason: null }]);
  });

  it('records nothing for wording changed since it was read: type, audience, title or text (finding 5)', async () => {
    const row = await draft(words(), { type: 'policy' });
    const [target] = await asPrincipal(workers(1), ({ tx }) => playbookCheckTargets(tx, row.id));
    if (target === undefined) throw new Error('no target');
    const embedding = fakeEmbedding(directiveText(target));
    const read = await asPrincipal(workers(1), ({ tx }) =>
      playbookCandidates(tx, row.id, embedding, 0.2, 5),
    );
    // Only the type changes: the text is the same, the wording is not.
    await run(gm, editPlaybookDirective, {
      entityId: 1,
      directiveId: row.id,
      type: 'sop',
      audience: 'staff',
      title: 'Synthetic check rule',
      text: target.text,
    });
    const skipped = await run(workers(1), recordPlaybookCheck, {
      entityId: 1,
      directiveId: row.id,
      wordingSha256: target.wordingSha256,
      checkedAsOf: read.readAt,
      embedding,
      pairs: [],
    });
    expect(skipped).toMatchObject({ skipped: true });
    expect((await directive(row.id))?.checked).toBe(false);
  });

  it('files the record under the draft’s company, whichever company the worker acts in (finding 9)', async () => {
    const shared = words();
    const row = await draft(shared, { type: 'priority', entityId: 3 });
    const group = await approved(`${shared} ${words(1)}`, { type: 'priority', wholeGroup: true });
    // The group rule's event, from a request for company 1, rechecks the company-3 draft.
    await check(group.id, provider({ replies: [label('overlap')] }).ai, 'approved', 1);
    expect((await pairs(row.id)).map((p) => p.other_id)).toContain(group.id);
    const [row3] = await asMigrator(
      (m) => m<{ entity_id: number | null }[]>`
        select entity_id from audit_logs
         where aggregate_id = ${row.id} and command = 'knowledge.playbook.record_check'
         order by created_at desc limit 1`,
    );
    expect(row3?.entity_id).toBe(3);
  });

  it('is the platform’s alone: a person, an agent and another company are refused', async () => {
    const row = await draft(words());
    const input = {
      entityId: 1,
      directiveId: row.id,
      wordingSha256: '0'.repeat(64),
      checkedAsOf: '2026-11-13 00:00:00+00',
      embedding: Array.from({ length: 1024 }, () => 0.01),
      pairs: [],
    };
    await expect(run(executive, recordPlaybookCheck, input)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(run(workers(2), recordPlaybookCheck, input)).rejects.toMatchObject({
      code: 'forbidden',
    });
    // The definers refuse anyone without the platform's grant, whatever they read, and the
    // platform without a company (the check fails closed).
    await expect(
      asPrincipal(executive, ({ tx }) =>
        tx.execute(sql`select * from app.playbook_check_targets(${row.id}::uuid)`),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    await expect(
      asPrincipal({ ...workers(1), entityIds: [] }, ({ tx }) =>
        tx.execute(sql`select * from app.playbook_check_targets(${row.id}::uuid)`),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });
});
