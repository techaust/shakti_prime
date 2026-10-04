import { newId, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  principalFor,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit, memoryAuditSink } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { createLead } from '../../src/commands/crm/create-lead';
import { setCommissionRule, setReferralPartner } from '../../src/commands/crm/referrals';
import { rescoreLead, setScoreRules } from '../../src/commands/crm/score-rules';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';

// Score rules are matched to a district of this run only, so rescoring never changes another
// suite's leads; every rule, partner code and commission rule written here is removed afterwards.

const RUN = newId().slice(-8);
const DISTRICT = `District ${RUN}`;
const partners: string[] = [];

let exec: Principal;
let execOne: Principal;
let execTwo: Principal;
let gm: Principal;
let gmTwo: Principal;
let caller: Principal;
let teamId: string;

beforeAll(async () => {
  teamId = await createTestTeam(1, 'scoring team');
  exec = await createTestPrincipal('executive');
  execOne = await createTestPrincipal('executive', [1]);
  execTwo = await createTestPrincipal('executive', [2]);
  gm = await createTestPrincipal('general_manager', [1]);
  gmTwo = await createTestPrincipal('general_manager', [2]);
  caller = await createTestPrincipal('tele_caller_cc', [1], { teamId });
});

afterAll(async () => {
  await asMigrator(async (m) => {
    const actors = [exec.id, execOne.id, execTwo.id];
    await m`delete from lead_score_rules where created_by = any(${actors}::uuid[])`;
    await m`delete from commission_rules where created_by = any(${actors}::uuid[])`;
    await m`update opportunities set referral_partner_id = null
             where referral_partner_id = any(${partners}::uuid[])`;
    await m`delete from commission_rules where partner_id = any(${partners}::uuid[])`;
    await m`delete from referral_partners where account_id = any(${partners}::uuid[])`;
    // The leads of this run go back to the base, as they would once their rules are gone.
    await m`update opportunities set score = 50, score_reasons_json = '[]'::jsonb,
              score_changed_at = null, score_changed_by = null
             where created_by = ${caller.id}`;
  });
  await closeDb();
});

function run(principal: Principal, command: AnyCommand, input: unknown): Promise<unknown> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  );
}

function refusal(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (e: unknown) => e,
  );
}

function phone(): string {
  return `96${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
}

/** A lead of company 1 owned by `caller`, its site in this run's district. */
async function lead(
  accountType = 'farm',
  district = DISTRICT,
): Promise<{ id: string; accountId: string }> {
  const created = (await run(caller, createLead, {
    entityId: 1,
    pipelineKey: 'farmer_pumps',
    contact: { name: 'Scoring customer', phone: phone() },
    account: { type: accountType },
    site: { type: 'borewell', village: 'Scoring village' },
  })) as { id: string; account: { id: string } };
  await asMigrator(
    (m) => m`update customer_sites set district = ${district}
              where id = (select site_id from opportunities where id = ${created.id})`,
  );
  return { id: created.id, accountId: created.account.id };
}

async function scoreOf(id: string) {
  const [row] = await asMigrator(
    (m) => m<{ score: number; reasons: unknown; by: string | null; partner: string | null }[]>`
      select score, score_reasons_json as reasons, score_changed_by as by,
             referral_partner_id as partner
        from opportunities where id = ${id}`,
  );
  return row;
}

const districtRule = (points: number, district = DISTRICT) => ({
  factor: 'district',
  match: { districts: [district] },
  points,
});

describe('crm.score_rule.set', () => {
  it('is refused to a role without crm.config.write, to an agent, and outside the request', async () => {
    const input = { entityId: 1, segment: null, rules: [districtRule(10)] };
    for (const principal of [gm, caller, principalFor('agent:triage', [1])]) {
      expect(await refusal(run(principal, setScoreRules, input))).toMatchObject({
        code: 'forbidden',
      });
    }
    expect(await refusal(run(execOne, setScoreRules, { ...input, entityId: 2 }))).toMatchObject({
      details: { reason: 'config_company_scope' },
    });
    expect(await refusal(run(execOne, setScoreRules, { ...input, entityId: null }))).toMatchObject({
      details: { reason: 'config_group_scope' },
    });
  });

  it('refuses points outside −50 to 50, zero points and an unreadable match at validation', async () => {
    for (const rule of [
      districtRule(51),
      districtRule(0),
      { factor: 'age_days', match: {}, points: 5 },
      { factor: 'district', match: { codes: ['x'] }, points: 5 },
    ]) {
      expect(
        await refusal(run(exec, setScoreRules, { entityId: 1, segment: null, rules: [rule] })),
      ).toMatchObject({ code: 'validation_failed' });
    }
  });

  it('rescores the open leads of its scope in the same change, and back when the rules are cleared', async () => {
    const leads = [await lead(), await lead(), await lead()];
    await asMigrator(
      (m) => m`update opportunities set state = 'won' where id = ${leads[2]?.id ?? ''}`,
    );
    for (const l of leads) expect((await scoreOf(l.id))?.score).toBe(50);

    const recorded = memoryAuditSink();
    const set = await asPrincipal(execOne, (context) =>
      runCommand(
        setScoreRules,
        { context, audit: recorded, outbox },
        { entityId: 1, segment: 'farmer_pumps', rules: [districtRule(20), districtRule(-5)] },
      ),
    );
    // Any lead still scored by rules an earlier run removed is corrected too.
    expect(set).toMatchObject({ entityId: 1, segment: 'farmer_pumps' });
    expect(set.rescored).toBeGreaterThanOrEqual(2);
    expect(set.rules.map((r) => r.points)).toEqual([20, -5]);
    for (const l of leads.slice(0, 2)) {
      expect(await scoreOf(l.id)).toMatchObject({
        score: 65,
        by: execOne.id,
        reasons: [
          { factor: 'district', points: 20, labelKey: 'leads.score.reasons.district' },
          { factor: 'district', points: -5, labelKey: 'leads.score.reasons.district' },
        ],
      });
    }
    // A won lead is not in the queue and keeps its score.
    expect((await scoreOf(leads[2]?.id ?? ''))?.score).toBe(50);
    // Two rules added and one rescoring batch recorded.
    expect(recorded.records.map((r) => r.aggregateType).sort()).toEqual([
      'lead_score_batch',
      'lead_score_rule',
      'lead_score_rule',
    ]);

    const again = await run(execOne, setScoreRules, {
      entityId: 1,
      segment: 'farmer_pumps',
      rules: [districtRule(20), districtRule(-5)],
    });
    expect(again).toMatchObject({ rescored: 0 });

    const cleared = await run(execOne, setScoreRules, {
      entityId: 1,
      segment: 'farmer_pumps',
      rules: [],
    });
    expect(cleared).toMatchObject({ rules: [], rescored: 2 });
    expect(await scoreOf(leads[0]?.id ?? '')).toMatchObject({ score: 50, reasons: [] });
  });

  it('treats a rule saved again with its keys in another order as unchanged', async () => {
    const scope = { entityId: 1, segment: 'residential_rooftop' as const };
    const sized = (match: Record<string, unknown>) => ({ factor: 'system_size', match, points: 5 });
    const first = (await run(execOne, setScoreRules, {
      ...scope,
      rules: [sized({ unit: 'kw', min: 3, max: 10 })],
    })) as { rules: { id: string }[] };
    const recorded = memoryAuditSink();
    const again = await asPrincipal(execOne, (context) =>
      runCommand(
        setScoreRules,
        { context, audit: recorded, outbox },
        { ...scope, rules: [sized({ max: 10, min: 3, unit: 'kw' })] },
      ),
    );
    expect(again.rules.map((r) => r.id)).toEqual(first.rules.map((r) => r.id));
    expect(again.rescored).toBe(0);
    // Only the call itself is recorded; no rule changed.
    expect(recorded.records.filter((r) => r.aggregateType !== null)).toEqual([]);
    await run(execOne, setScoreRules, { ...scope, rules: [] });
  });

  it('keeps a group rule to a request acting for every company, and applies it in every company', async () => {
    const district = `Group ${DISTRICT}`;
    const l = await lead('farm', district);
    const set = await run(exec, setScoreRules, {
      entityId: null,
      segment: null,
      rules: [districtRule(-20, district)],
    });
    expect((set as { rescored: number }).rescored).toBeGreaterThanOrEqual(1);
    expect((await scoreOf(l.id))?.score).toBe(30);
    await run(exec, setScoreRules, { entityId: null, segment: null, rules: [] });
    expect((await scoreOf(l.id))?.score).toBe(50);
  });
});

describe('crm.lead.rescore', () => {
  it('scores one lead with the rules that apply to it now', async () => {
    const district = `Single ${DISTRICT}`;
    const l = await lead('farm', district);
    await asMigrator(
      (
        m,
      ) => m`insert into lead_score_rules (id, entity_id, segment, factor, match_json, points, position, created_by)
               values (${newId()}, 1, null, 'district', ${m.json({ districts: [district] })}, 15, 1, ${exec.id})`,
    );
    const recorded = memoryAuditSink();
    const done = await asPrincipal(caller, (context) =>
      runCommand(
        rescoreLead,
        { context, audit: recorded, outbox },
        { entityId: 1, opportunityId: l.id },
      ),
    );
    expect(done).toMatchObject({ opportunityId: l.id, score: 65 });
    expect(recorded.records).toEqual([
      expect.objectContaining({ before: { score: 50 }, after: { score: 65 } }),
    ]);
    // Nothing changed: no score is written.
    const quiet = memoryAuditSink();
    await asPrincipal(caller, (context) =>
      runCommand(
        rescoreLead,
        { context, audit: quiet, outbox },
        { entityId: 1, opportunityId: l.id },
      ),
    );
    // One row for the call, naming no changed lead.
    expect(quiet.records).toEqual([
      expect.objectContaining({ aggregateId: null, before: null, after: null }),
    ]);
    await asMigrator(
      (m) => m`update lead_score_rules set archived_at = now() where created_by = ${exec.id}`,
    );
  });

  it("is refused to a role without crm.lead.write, and does not reach another company's lead", async () => {
    const l = await lead();
    expect(
      await refusal(
        run(principalFor('accounts', [1]), rescoreLead, { entityId: 1, opportunityId: l.id }),
      ),
    ).toMatchObject({ code: 'forbidden' });
    expect(
      await refusal(run(gmTwo, rescoreLead, { entityId: 1, opportunityId: l.id })),
    ).toMatchObject({ code: 'forbidden' });
    expect(
      await refusal(run(gmTwo, rescoreLead, { entityId: 2, opportunityId: l.id })),
    ).toMatchObject({ code: 'not_found', details: { reason: 'lead_missing' } });
  });
});

describe('crm.referral_partner.set', () => {
  it('gives a referral-partner customer its code, unique whatever its case', async () => {
    const { accountId } = await lead('referral_partner');
    partners.push(accountId);
    const code = `R${RUN.slice(0, 7)}`.toUpperCase();
    const recorded = memoryAuditSink();
    const done = await asPrincipal(execOne, (context) =>
      runCommand(
        setReferralPartner,
        { context, audit: recorded, outbox },
        { accountId, code: code.toLowerCase(), isActive: true },
      ),
    );
    expect(done).toEqual({ accountId, code, isActive: true });
    // The partner is a customer of company 1 only, so its row carries that company.
    expect(recorded.records[0]).toMatchObject({
      aggregateType: 'referral_partner',
      entityId: 1,
      before: null,
      after: { code, codeActive: true },
    });

    const other = await lead('referral_partner');
    partners.push(other.accountId);
    expect(
      await refusal(
        run(execOne, setReferralPartner, {
          accountId: other.accountId,
          code: code.toLowerCase(),
          isActive: true,
        }),
      ),
    ).toMatchObject({ code: 'conflict', details: { reason: 'referral_code_taken' } });
  });

  it('is set only by an Executive, for a referral-partner customer of a company in the request', async () => {
    const farm = await lead();
    expect(
      await refusal(
        run(execOne, setReferralPartner, {
          accountId: farm.accountId,
          code: 'FARM1234',
          isActive: true,
        }),
      ),
    ).toMatchObject({ details: { reason: 'referral_account_type' } });
    const partner = await lead('referral_partner');
    partners.push(partner.accountId);
    for (const refused of [caller, gm]) {
      expect(
        await refusal(
          run(refused, setReferralPartner, {
            accountId: partner.accountId,
            code: 'OWN12345',
            isActive: true,
          }),
        ),
      ).toMatchObject({ code: 'forbidden' });
    }
    expect(
      await refusal(
        run(execTwo, setReferralPartner, {
          accountId: partner.accountId,
          code: 'TWO12345',
          isActive: true,
        }),
      ),
    ).toMatchObject({ code: 'not_found', details: { reason: 'account_missing' } });
  });
});

describe('crm.lead.create with a referral code and score rules', () => {
  /** A lead made through the command, with its score and its partner as stored. */
  async function attributed(principal: Principal, input: unknown) {
    const recorded = memoryAuditSink();
    const created = (await asPrincipal(principal, (context) =>
      runCommand(createLead, { context, audit: recorded, outbox }, input),
    )) as { id: string; score: number; scoreReasons: unknown[] };
    const stored = await scoreOf(created.id);
    return { ...created, partner: stored?.partner ?? null, audit: recorded.records };
  }

  async function partnerWithCode(isActive = true): Promise<string> {
    const { accountId } = await lead('referral_partner');
    partners.push(accountId);
    const code = `A${newId().slice(-7)}`.toUpperCase();
    await run(execOne, setReferralPartner, { accountId, code, isActive });
    return code;
  }

  const leadInput = (referralCode?: string) => ({
    entityId: 1,
    pipelineKey: 'farmer_pumps',
    contact: { name: 'Referred customer', phone: phone() },
    account: { type: 'farm' },
    ...(referralCode === undefined ? {} : { referralCode }),
  });

  it('credits the lead to the partner a code names, whatever its case', async () => {
    const code = await partnerWithCode();
    const done = await attributed(caller, leadInput(code.toLowerCase()));
    expect(done.partner).toBe(partners.at(-1));
    // The lead's creation row records the partner and the score.
    expect(done.audit).toEqual([
      expect.objectContaining({
        aggregateType: 'opportunity',
        aggregateId: done.id,
        after: expect.objectContaining({ referralPartnerId: partners.at(-1), score: 50 }),
      }),
    ]);
  });

  it('refuses the whole lead for a code no active partner has', async () => {
    const inactive = await partnerWithCode(false);
    for (const code of ['ZZZZ9999', inactive]) {
      const input = leadInput(code);
      expect(await refusal(attributed(caller, input))).toMatchObject({
        code: 'validation_failed',
        details: { reason: 'referral_code_unknown' },
      });
      const leftover = await asMigrator(
        (m) => m<{ n: number }[]>`select count(*)::int as n from contact_phones
                                    where e164 = ${`+91${input.contact.phone}`}`,
      );
      expect(leftover[0]?.n).toBe(0);
    }
  });

  it('scores a new lead with the rules of its company, and leaves it at the base with none', async () => {
    const plain = await attributed(caller, leadInput());
    expect(plain.score).toBe(50);
    expect(plain.partner).toBeNull();
    expect(await scoreOf(plain.id)).toMatchObject({ score: 50, reasons: [], by: null });

    await asMigrator(
      (
        m,
      ) => m`insert into lead_score_rules (id, entity_id, segment, factor, match_json, points, position, created_by)
               values (${newId()}, 1, 'farmer_pumps', 'source', ${m.json({ sourceCodes: ['walk_in'] })}, 25, 1, ${execOne.id})`,
    );
    try {
      const walkIn = await attributed(caller, { ...leadInput(), sourceCode: 'walk_in' });
      expect(walkIn.score).toBe(75);
      expect(walkIn.scoreReasons).toEqual([
        expect.objectContaining({ factor: 'source', points: 25 }),
      ]);
      expect(walkIn.audit).toEqual([
        expect.objectContaining({ after: expect.objectContaining({ score: 75 }) }),
      ]);
      expect(await scoreOf(walkIn.id)).toMatchObject({ score: 75, by: caller.id });
    } finally {
      await asMigrator(
        (m) => m`update lead_score_rules set archived_at = now() where created_by = ${execOne.id}`,
      );
    }
  });

  it('refuses a code whose partner is not a live customer of the company of the lead', async () => {
    const code = await partnerWithCode();
    const partner = partners.at(-1) ?? '';
    const callerTwo = await createTestPrincipal('tele_caller_cc', [2]);
    expect(await refusal(attributed(callerTwo, { ...leadInput(code), entityId: 2 }))).toMatchObject(
      { details: { reason: 'referral_code_unknown' } },
    );
    await asMigrator((m) => m`update accounts set archived_at = now() where id = ${partner}`);
    try {
      expect(await refusal(attributed(caller, leadInput(code)))).toMatchObject({
        details: { reason: 'referral_code_unknown' },
      });
    } finally {
      await asMigrator((m) => m`update accounts set archived_at = null where id = ${partner}`);
    }
  });

  it('resolves codes only for a caller who may write leads, in a company of the request', async () => {
    const answer = (principal: Principal, entityId: number) =>
      refusal(
        asPrincipal(principal, ({ tx }) =>
          tx.execute(sql`select app.referral_partner_for_code('ABCD1234', ${entityId}::smallint)`),
        ),
      );
    expect(await answer(principalFor('accounts', [1]), 1)).toBeInstanceOf(Error);
    expect(await answer(caller, 2)).toBeInstanceOf(Error);
    expect(await answer(caller, 1)).toBeUndefined();
  });
});

describe('crm.commission_rule.set', () => {
  it('is refused to a GM, and to an Executive acting for one company', async () => {
    const input = {
      partnerId: null,
      basis: 'fixed',
      amount: '500.00',
      effectiveFrom: '2091-04-01',
    };
    expect(await refusal(run(gm, setCommissionRule, input))).toMatchObject({ code: 'forbidden' });
    expect(await refusal(run(execOne, setCommissionRule, input))).toMatchObject({
      details: { reason: 'config_group_scope' },
    });
  });

  it('sets a rule from a date, ending the open one before it, and refuses an overlap', async () => {
    const { accountId } = await lead('referral_partner');
    partners.push(accountId);
    await run(execOne, setReferralPartner, {
      accountId,
      code: `C${newId().slice(-7)}`.toUpperCase(),
      isActive: true,
    });
    const first = (await run(exec, setCommissionRule, {
      partnerId: accountId,
      basis: 'percent',
      amount: '2.50',
      effectiveFrom: '2091-04-01',
    })) as { id: string };
    const second = await run(exec, setCommissionRule, {
      partnerId: accountId,
      basis: 'per_kw',
      amount: '750.00',
      effectiveFrom: '2092-04-01',
    });
    expect(second).toMatchObject({
      partnerId: accountId,
      basis: 'per_kw',
      amount: '750.00',
      trigger: 'order_confirmed',
      effectiveTo: null,
    });
    const [closed] = await asMigrator(
      (m) =>
        m<
          { to: string }[]
        >`select effective_to::text as to from commission_rules where id = ${first.id}`,
    );
    expect(closed?.to).toBe('2092-04-01');
    expect(
      await refusal(
        run(exec, setCommissionRule, {
          partnerId: accountId,
          basis: 'fixed',
          amount: '100.00',
          effectiveFrom: '2091-06-01',
          effectiveTo: '2091-09-01',
        }),
      ),
    ).toMatchObject({ code: 'validation_failed', details: { reason: 'commission_rule_overlap' } });
    expect(
      await refusal(
        run(exec, setCommissionRule, {
          partnerId: newId(),
          basis: 'fixed',
          amount: '100.00',
          effectiveFrom: '2091-04-01',
        }),
      ),
    ).toMatchObject({ details: { reason: 'commission_partner_missing' } });
    expect(
      await refusal(
        run(exec, setCommissionRule, {
          partnerId: null,
          basis: 'percent',
          amount: '101.00',
          effectiveFrom: '2091-04-01',
        }),
      ),
    ).toMatchObject({ code: 'validation_failed' });
  });

  it('is read by those who set rules or pay commission, and by no one else', async () => {
    const count = (principal: Principal) =>
      asPrincipal(principal, async ({ tx }) => {
        const rows = (await tx.execute(
          sql`select count(*)::int as n from commission_rules`,
        )) as unknown as { n: number }[];
        return rows[0]?.n ?? 0;
      });
    expect(await count(exec)).toBeGreaterThan(0);
    expect(await count(principalFor('accounts', [1]))).toBeGreaterThan(0);
    expect(await count(principalFor('tele_caller_lc', [1]))).toBe(0);
    expect(await count(gm)).toBe(0);
    expect(await count(caller)).toBe(0);
    expect(await count(principalFor('agent:triage', [1]))).toBe(0);
  });
});
