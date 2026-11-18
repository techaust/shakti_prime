import {
  newId,
  ROLE_KEYS,
  type PlaybookAudience,
  type PlaybookDirectiveState,
  type Principal,
  type RoleKey,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  grantsForRole,
  principalFor,
  withoutContext,
} from '../../src/testing/index';

// Playbook directives under row-level security (docs/03-roadmap-appendix/phase2.md §5.4, SECURITY
// §3.2 and §7): each audience is read per role, a draft or retired directive only by the holders
// of the playbook grants (so never by an agent), a directive of the whole group in any company,
// and every change keeps to the `playbook_directive` machine. The text is synthetic.

const made: string[] = [];
let owner: Principal;

beforeAll(async () => {
  owner = await createTestPrincipal('executive');
});

afterAll(async () => {
  await asMigrator(async (m) => {
    await m`delete from playbook_conflict_checks where directive_id = any(${made}) or other_id = any(${made})`;
    await m`delete from playbook_directives where id = any(${made})`;
  });
  await closeDb();
});

/** A directive written as the owner, in the given state. */
async function directive(
  entityId: number | null,
  audience: PlaybookAudience,
  state: PlaybookDirectiveState,
): Promise<string> {
  const id = newId();
  const approved = state !== 'draft';
  await asMigrator(
    (m) => m`insert into playbook_directives
      (id, entity_id, type, audience, title, text, state, approved_by, approved_at, checked_at,
       retired_reason, retired_at, created_by)
      values (${id}, ${entityId}, 'faq', ${audience}, 'rls rule', 'rls rule text', ${state},
              ${approved ? owner.id : null}, ${approved ? new Date() : null},
              ${approved ? new Date() : null},
              ${state === 'retired' ? 'rls reason' : null}, ${state === 'retired' ? new Date() : null},
              ${owner.id})`,
  );
  made.push(id);
  return id;
}

async function seen(who: Principal, ids: readonly string[]): Promise<string[]> {
  const rows = await asPrincipal(
    who,
    async ({ tx }) =>
      (await tx.execute(
        sql`select id::text from playbook_directives
           where id = any(string_to_array(${ids.join(',')}, ',')::uuid[])`,
      )) as unknown as { id: string }[],
  );
  return rows.map((r) => r.id).sort();
}

/** Refused by the guard trigger or a write policy, never by a check constraint. */
async function refused(write: Promise<unknown>): Promise<void> {
  await expect(write).rejects.toMatchObject({ cause: { code: '42501' } });
}

const holds = (role: RoleKey, key: string): boolean =>
  grantsForRole(role).some((g) => g.key === key && g.scope === 'all');

describe('who reads a directive', () => {
  it('reads each audience of an approved directive per role, and a draft only with a playbook grant', async () => {
    const approved = {
      customer: await directive(1, 'customer', 'approved'),
      staff: await directive(1, 'staff', 'approved'),
      management: await directive(1, 'management', 'approved'),
    };
    const draft = await directive(1, 'staff', 'draft');
    const retired = await directive(1, 'staff', 'retired');
    const all = [...Object.values(approved), draft, retired];
    for (const role of ROLE_KEYS) {
      const who = principalFor(role, [1]);
      const staff = holds(role, 'knowledge.vault.read.staff');
      const management = holds(role, 'knowledge.vault.read.management');
      const playbook =
        holds(role, 'knowledge.playbook.draft') || holds(role, 'knowledge.playbook.approve');
      const expected = [
        ...(staff ? [approved.customer, approved.staff] : []),
        ...(management ? [approved.management] : []),
        ...(staff && playbook ? [draft, retired] : []),
      ].sort();
      expect({ role, seen: await seen(who, all) }).toEqual({ role, seen: expected });
    }
  });

  it('never shows an agent a draft (a draft never steers an agent)', async () => {
    const draft = await directive(1, 'customer', 'draft');
    const approved = await directive(1, 'customer', 'approved');
    const copilot = principalFor('agent:copilot', [1]);
    expect(await seen(copilot, [draft, approved])).toEqual([approved]);
  });

  it('shows a directive of the group in any company, one of a company only there, and nothing without a company', async () => {
    const group = await directive(null, 'staff', 'approved');
    const two = await directive(2, 'staff', 'approved');
    const caller = principalFor('tele_caller_cc', [1]);
    expect(await seen(caller, [group, two])).toEqual([group]);
    expect(await seen(principalFor('tele_caller_cc', [2]), [group, two])).toEqual(
      [group, two].sort(),
    );
    const none = await withoutContext<{ n: number }>(
      sql`select count(*)::int as n from playbook_directives`,
    );
    expect(none[0]?.n).toBe(0);
  });
});

describe('who writes a directive', () => {
  const insert = (
    who: Principal,
    over: { entityId?: number | null; audience?: string; state?: string } = {},
  ) =>
    asPrincipal(who, ({ tx }) =>
      tx.execute(sql`insert into playbook_directives (id, entity_id, type, audience, title, text, state, created_by)
        values (${newId()}, ${over.entityId === undefined ? 1 : over.entityId}, 'faq',
                ${over.audience ?? 'staff'}, 'rls rule', 'rls rule text', ${over.state ?? 'draft'}, ${who.id})`),
    );

  it('lets a drafter write a draft and refuses everyone else, any other state, and the group from one company', async () => {
    const gm = await createTestPrincipal('general_manager', [1]);
    await expect(insert(gm)).resolves.toBeDefined();
    // An approved row that meets every check constraint: the insert policy alone refuses it.
    await refused(
      asPrincipal(gm, ({ tx }) =>
        tx.execute(sql`insert into playbook_directives
          (id, entity_id, type, audience, title, text, state, approved_by, approved_at, checked_at, created_by)
          values (${newId()}, 1, 'faq', 'staff', 'rls rule', 'rls rule text', 'approved', ${gm.id},
                  now(), now(), ${gm.id})`),
      ),
    );
    await refused(insert(gm, { entityId: null }));
    await refused(insert(gm, { entityId: 2 }));
    await refused(insert(await createTestPrincipal('accounts', [1])));
    await refused(insert(principalFor('agent:copilot', [1])));
    await asMigrator((m) => m`delete from playbook_directives where created_by = ${gm.id}`);
  });

  it('keeps every change on the machine, each refusal the guard’s or a policy’s (42501)', async () => {
    const gm = await createTestPrincipal('general_manager', [1]);
    const exec = await createTestPrincipal('executive', [1]);
    const draft = await directive(1, 'staff', 'draft');
    const approve = (who: Principal, id: string) =>
      asPrincipal(who, ({ tx }) =>
        tx.execute(sql`update playbook_directives
                          set state = 'approved', approved_by = ${who.id}, approved_at = now(),
                              conflicts_with = '{}'::uuid[]
                        where id = ${id}`),
      );
    // Checked, but before an approval of its type for its company: the check is stale.
    await asMigrator(
      (m) =>
        m`update playbook_directives set checked_at = now() - interval '1 hour' where id = ${draft}`,
    );
    await directive(1, 'staff', 'approved');
    await refused(approve(exec, draft));
    // Checked after it, but an open pair remains, though the update clears `conflicts_with`.
    const other = await directive(1, 'staff', 'approved');
    const pair = newId();
    await asMigrator(async (m) => {
      await m`update playbook_directives set checked_at = clock_timestamp() where id = ${draft}`;
      await m`insert into playbook_conflict_checks (id, entity_id, directive_id, other_id, distance, label, reason)
              values (${pair}, 1, ${draft}, ${other}, 0.1, 'conflict', 'rls reason')`;
    });
    await refused(approve(exec, draft));
    await asMigrator((m) => m`delete from playbook_conflict_checks where id = ${pair}`);
    // A drafter is not an approver.
    await refused(approve(gm, draft));
    // A request may not record a check or name a conflict.
    await refused(
      asPrincipal(exec, ({ tx }) =>
        tx.execute(
          sql`update playbook_directives set conflicts_with = array[${newId()}]::uuid[] where id = ${draft}`,
        ),
      ),
    );
    await expect(approve(exec, draft)).resolves.toBeDefined();
    const [stamped] = await asMigrator(
      (m) => m<{ later: boolean }[]>`
        select approved_at > checked_at as later from playbook_directives where id = ${draft}`,
    );
    // The guard takes the approval's time from the database once the type's lock is held.
    expect(stamped?.later).toBe(true);
    await refused(
      asPrincipal(exec, ({ tx }) =>
        tx.execute(sql`update playbook_directives set text = 'rls reworded' where id = ${draft}`),
      ),
    );
    // Retiring an approved directive is the approver's.
    await refused(
      asPrincipal(gm, ({ tx }) =>
        tx.execute(sql`update playbook_directives
                          set state = 'retired', retired_reason = 'rls', retired_at = now()
                        where id = ${draft}`),
      ),
    );
  });

  it('rewording a draft clears its check', async () => {
    const gm = await createTestPrincipal('general_manager', [1]);
    const draft = await directive(1, 'staff', 'draft');
    await asMigrator(
      (m) => m`update playbook_directives
                  set checked_at = now(), embedding = array_fill(0.1::real, array[1024])::vector
                where id = ${draft}`,
    );
    await asPrincipal(gm, ({ tx }) =>
      tx.execute(sql`update playbook_directives set text = 'rls reworded' where id = ${draft}`),
    );
    const [row] = await asMigrator(
      (m) => m<{ checked: boolean; embedded: boolean }[]>`
        select checked_at is not null as checked, embedding is not null as embedded
          from playbook_directives where id = ${draft}`,
    );
    expect(row).toEqual({ checked: false, embedded: false });
  });
});

describe('the conflict check’s pairs', () => {
  it('are read only with a playbook grant, and resolved only by the approver as themselves', async () => {
    const draft = await directive(1, 'staff', 'draft');
    const other = await directive(1, 'staff', 'approved');
    const pair = newId();
    await asMigrator(
      (
        m,
      ) => m`insert into playbook_conflict_checks (id, entity_id, directive_id, other_id, distance, label, reason)
               values (${pair}, 1, ${draft}, ${other}, 0.1, 'conflict', 'rls reason')`,
    );
    const count = (who: Principal) =>
      asPrincipal(who, async ({ tx }) => {
        const rows = (await tx.execute(
          sql`select count(*)::int as n from playbook_conflict_checks where id = ${pair}`,
        )) as unknown as { n: number }[];
        return rows[0]?.n;
      });
    expect(await count(principalFor('general_manager', [1]))).toBe(1);
    expect(await count(principalFor('accounts', [1]))).toBe(0);
    expect(await count(principalFor('agent:copilot', [1]))).toBe(0);
    const resolve = (who: Principal, by: string) =>
      asPrincipal(who, ({ tx }) =>
        tx.execute(sql`update playbook_conflict_checks
                          set resolution = 'not_a_conflict', resolved_by = ${by}, resolved_at = now()
                        where id = ${pair}`),
      );
    const gm = await createTestPrincipal('general_manager', [1]);
    const exec = await createTestPrincipal('executive', [1]);
    // A drafter reads the pair but does not resolve it (no row passes the update policy).
    await resolve(gm, gm.id);
    await refused(resolve(exec, gm.id));
    await resolve(exec, exec.id);
    const [row] = await asMigrator(
      (m) =>
        m<
          { resolved_by: string }[]
        >`select resolved_by from playbook_conflict_checks where id = ${pair}`,
    );
    expect(row?.resolved_by).toBe(exec.id);
    await refused(resolve(exec, exec.id));
    // No request inserts a pair.
    await refused(
      asPrincipal(exec, ({ tx }) =>
        tx.execute(sql`insert into playbook_conflict_checks (id, entity_id, directive_id, other_id, distance)
                       values (${newId()}, 1, ${draft}, ${other}, 0.1)`),
      ),
    );
  });
});
