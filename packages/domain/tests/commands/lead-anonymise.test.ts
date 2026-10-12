import { SYSTEM_WORKERS_PRINCIPAL_ID, type Principal } from '@shakti/contracts';
import { asMigrator, asPrincipal, closeDb, PIPELINE_SEED, principalFor } from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { executeQuery } from '../../src/command/execute';
import { failureOf, runCommand } from '../../src/command/run-command';
import { anonymiseStaleLeads } from '../../src/commands/crm/anonymise-stale-leads';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { countStaleLeads } from '../../src/queries/crm/stale-leads';

// `crm.lead.anonymise` and its dry run (BLUEPRINT §7.9): run by the worker principal a batch at a
// time, refused to people and outside the request, one audit row per anonymised lead with no
// personal value in it. The lead is made in company 3 with a last change in 2001, so it is the
// oldest of its company; the definers' rules are proved in packages/db/tests/security.

afterAll(closeDb);

const E = 3;
const P = '01990000-0000-7000-8000-0000000a8';
const id = (n: number): string => `${P}${n.toString(16).padStart(3, '0')}`;
const LEAD = id(1);
const ACCOUNT = id(2);
const CONTACT = id(3);
const ACTOR = id(4);
const NAME = 'Anonymise Fixture Person';
const PHONE = '+919700099991';

const workers = (entityIds: number[] = [E]): Principal =>
  principalFor('system:workers', entityIds, { id: SYSTEM_WORKERS_PRINCIPAL_ID });

function run<T>(principal: Principal, command: AnyCommand, input: unknown): Promise<T> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  ) as Promise<T>;
}

async function failure(
  principal: Principal,
  input: unknown,
): Promise<{ code?: string | undefined; stage?: string | undefined }> {
  const error: unknown = await run(principal, anonymiseStaleLeads, input).then(
    () => undefined,
    (e: unknown) => e,
  );
  return { code: (error as { code?: string } | undefined)?.code, stage: failureOf(error)?.stage };
}

beforeAll(async () => {
  const pipeline = PIPELINE_SEED[0];
  if (pipeline === undefined) throw new Error('pipeline seed missing');
  await asMigrator(async (m) => {
    const [stage] = await m<{ id: string }[]>`
      select id from pipeline_stages where pipeline_id = ${pipeline.id} and key = 'new'`;
    await m.begin(async (tx) => {
      const like = `${P}%`;
      await tx`alter table activities disable trigger activities_append_only`;
      await tx`delete from activities where account_id::text like ${like}`;
      await tx`alter table activities enable trigger activities_append_only`;
      // The nightly duplicate search of other suites may have paired this file's lead.
      await tx`delete from duplicate_candidates
                where opportunity_id::text like ${like} or other_opportunity_id::text like ${like}
                   or account_id::text like ${like} or other_account_id::text like ${like}`;
      await tx`delete from opportunities where id::text like ${like}`;
      await tx`delete from account_contacts where account_id::text like ${like}`;
      await tx`delete from account_entities where account_id::text like ${like}`;
      await tx`delete from contact_phones where contact_id::text like ${like}`;
      await tx`delete from accounts where id::text like ${like}`;
      await tx`delete from contacts where id::text like ${like}`;
      await tx`delete from principals where id = ${ACTOR}`;
      await tx`insert into principals (id, kind, display_name) values (${ACTOR}, 'user', 'anonymise fixture')`;
      const at = '2001-01-01';
      await tx`insert into contacts (id, name, email, created_by, created_at, updated_at)
               values (${CONTACT}, ${NAME}, 'fixture@example.in', ${ACTOR}, ${at}, ${at})`;
      await tx`insert into contact_phones (id, contact_id, e164, is_primary, created_by, created_at, updated_at)
               values (${id(5)}, ${CONTACT}, ${PHONE}, true, ${ACTOR}, ${at}, ${at})`;
      await tx`insert into accounts (id, type, name, created_by, created_at, updated_at)
               values (${ACCOUNT}, 'household', ${NAME}, ${ACTOR}, ${at}, ${at})`;
      await tx`insert into account_entities (id, account_id, entity_id, created_by, created_at, updated_at)
               values (${id(6)}, ${ACCOUNT}, ${E}, ${ACTOR}, ${at}, ${at})`;
      await tx`insert into account_contacts (account_id, contact_id, role, created_by, created_at, updated_at)
               values (${ACCOUNT}, ${CONTACT}, 'owner', ${ACTOR}, ${at}, ${at})`;
      await tx`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, created_by,
                                          created_at, updated_at, state_changed_at)
               values (${LEAD}, ${E}, ${ACCOUNT}, ${pipeline.id}, ${stage?.id ?? ''}, ${ACTOR},
                       ${at}, ${at}, ${at})`;
    });
  });
});

describe('crm.lead.anonymise', () => {
  it('is refused to every person and to a company outside the request', async () => {
    for (const role of ['executive', 'general_manager', 'tele_caller_cc'] as const) {
      expect(await failure(principalFor(role, [E]), { entityId: E })).toEqual({
        code: 'forbidden',
        stage: 'guard',
      });
    }
    expect(await failure(workers([1]), { entityId: E })).toMatchObject({ code: 'forbidden' });
  });

  it('counts in a dry run on a read-only request and changes nothing', async () => {
    const counted = await executeQuery(
      workers(),
      { entityIds: [E] },
      (context) => countStaleLeads(context, { entityId: E }),
      { name: 'countStaleLeads' },
    );
    expect(counted).toMatchObject({ entityId: E, next: null });
    expect(counted.stale).toBeGreaterThanOrEqual(1);
    await expect(
      executeQuery(
        principalFor('executive', [E]),
        { entityIds: [E] },
        (context) => countStaleLeads(context, { entityId: E }),
        { name: 'countStaleLeads' },
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const [lead] = await asMigrator(
      (m) => m<{ anonymised: Date | null }[]>`
        select anonymised_at as anonymised from opportunities where id = ${LEAD}`,
    );
    expect(lead?.anonymised).toBeNull();
  });

  it('anonymises a batch as system:workers, with one audit row per lead and no personal value', async () => {
    // The audit rows are never cleaned, so this run's are found by its own request id.
    let requestId = '';
    const batch = (await asPrincipal(workers(), (context) => {
      requestId = context.requestId;
      return runCommand(anonymiseStaleLeads, { context, audit, outbox }, { entityId: E, after: null });
    })) as { anonymised: number; failed: boolean; next: unknown };
    expect(batch).toMatchObject({ failed: false, next: null });
    expect(batch.anonymised).toBeGreaterThanOrEqual(1);
    const [lead] = await asMigrator(
      (m) => m<{ anonymised: boolean; name: string }[]>`
        select o.anonymised_at is not null as anonymised, a.name
          from opportunities o join accounts a on a.id = o.account_id where o.id = ${LEAD}`,
    );
    expect(lead).toEqual({ anonymised: true, name: '' });
    const rows = await asMigrator(
      (m) => m<{ command: string; actor: string; before: unknown; after: unknown; text: string }[]>`
        select command, actor_principal_id as actor, before_json as before, after_json as after,
               row_to_json(l)::text as text
          from audit_logs l where aggregate_id = ${LEAD} and request_id = ${requestId}`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      command: 'crm.lead.anonymise',
      actor: SYSTEM_WORKERS_PRINCIPAL_ID,
      before: { anonymisedAt: null },
      after: { anonymisedAt: expect.any(String) as string },
    });
    for (const value of [NAME, PHONE, 'fixture@example.in']) {
      expect(rows[0]?.text).not.toContain(value);
    }

    // A second run finds the lead done and records nothing more about it.
    const count = async () =>
      (
        await asMigrator(
          (m) => m<{ n: number }[]>`
            select count(*)::int as n from audit_logs where aggregate_id = ${LEAD}`,
        )
      )[0]?.n;
    const before = await count();
    const again = await run<{ anonymised: number }>(workers(), anonymiseStaleLeads, {
      entityId: E,
    });
    expect(again.anonymised).toBe(0);
    expect(await count()).toBe(before);
  });
});
