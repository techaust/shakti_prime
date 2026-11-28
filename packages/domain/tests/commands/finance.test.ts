import {
  newId,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type MilestoneTemplateDto,
  type PaymentMilestoneDto,
  type PlanConfirmedOutcome,
  type PlannedMilestonesDto,
  type Principal,
  type ProformaDto,
} from '@shakti/contracts';
import {
  asMigrator,
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  createTestUser,
  principalFor,
  tierId,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { failureOf, runCommand } from '../../src/command/run-command';
import {
  attachProformaPdf,
  cancelProforma,
  issueProforma,
  refreshMilestones,
  settleCancelledOrder,
  planConfirmedMilestones,
  planMilestonesByHand,
  publishPaymentTerms,
  waiveMilestone,
} from '../../src/commands/finance/index';
import { createCustomerLoan } from '../../src/commands/crm/loans-create';
import { sanctionCustomerLoan } from '../../src/commands/crm/loans-sanction';
import { notifyEvent } from '../../src/commands/notifications/notify';
import { istCalendarDate } from '../../src/numbering/financial-year';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { readOrderMilestones, readOrderProformas } from '../../src/queries/finance/finance-dto';
import { listPaymentTerms, readOrderPayments } from '../../src/queries/finance/order-payments';
import { loadProformaForPrint } from '../../src/queries/finance/proforma-print';

// FN1 proformas and payment milestones (docs/03-roadmap-appendix/phase5.md §6.1, §13): numbering
// with no gaps under concurrency, snapshots never recomputed, milestone amounts summing to the
// order's total, loan-gated milestones and the dispatch guard. Orders are written straight into
// company 4 (RCREF) as confirmed dealer orders whose relationship the Lead Converter owns; every price,
// rate and amount here is a synthetic test value, never a client figure.
const E = 4;
const P = '01990000-0000-7000-8000-000000f1';
const fixed = (n: number) => `${P}${n.toString(16).padStart(4, '0')}`;
const ids = {
  module: fixed(0x0001),
  cable: fixed(0x0002),
  rateModule: fixed(0x0003),
  rateCable: fixed(0x0004),
  rateLater: fixed(0x0005),
  lender: fixed(0x0006),
};

let teamId: string;
let lc: Principal;
let otherLc: Principal;
let salesLead: Principal;
let accounts: Principal;
let accounts1: Principal;
let exec: Principal;
let gm: Principal;
const workers = (): Principal => ({
  ...principalFor('system:workers', [E]),
  id: SYSTEM_WORKERS_PRINCIPAL_ID,
});
const madeBy = new Set<string>();

/** Triggers off for the rest of this migrator transaction only, so test rows can be removed. */
const withoutTriggers = (tx: (strings: TemplateStringsArray) => PromiseLike<unknown>) =>
  tx`set local session_replication_role = replica`;

/** Removes company 4's payment terms and the milestones planned from them, whatever a test left. */
async function removeTerms(): Promise<void> {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await withoutTriggers(tx);
      await tx`delete from payment_milestones where template_id in
                 (select id from payment_milestone_templates where entity_id = ${E})`;
      await tx`delete from payment_milestone_templates where entity_id = ${E}`;
    }),
  );
}

async function removeFinanceRows(): Promise<void> {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await withoutTriggers(tx);
      const orders = tx`select so.id from sales_orders so
                         join sales_order_lines l on l.sales_order_id = so.id
                        where l.item_id = ${ids.module}`;
      await tx`delete from payment_milestones where sales_order_id in (${orders})`;
      await tx`delete from customer_loans where sales_order_id in (${orders})`;
      await tx`delete from lenders where id = ${ids.lender}`;
      await tx`delete from proforma_lines where proforma_id in
                 (select id from proformas where sales_order_id in (${orders}))`;
      await tx`delete from proformas where sales_order_id in (${orders})`;
      await tx`delete from files where purpose in ('proforma_pdf', 'quote_pdf') and entity_id = ${E}
                 and created_by = ${SYSTEM_WORKERS_PRINCIPAL_ID} and sha256 = ${'d'.repeat(64)}`;
      await tx`delete from payment_milestone_templates where entity_id = ${E}`;
      await tx`delete from sales_order_lines where sales_order_id in (${orders})`;
      await tx`delete from sales_orders where id in (${orders})`;
      await tx`delete from tax_rates where id in (${ids.rateModule}, ${ids.rateCable}, ${ids.rateLater})`;
    }),
  );
}

beforeAll(async () => {
  await removeFinanceRows();
  teamId = await createTestTeam(E, 'finance team');
  const otherTeam = await createTestTeam(E, 'finance other team');
  lc = await createTestPrincipal('tele_caller_lc', [E], { teamId });
  otherLc = await createTestPrincipal('tele_caller_lc', [E], { teamId: otherTeam });
  salesLead = await createTestPrincipal('sales_team_lead', [E], { teamId });
  accounts = await createTestPrincipal('accounts', [E]);
  accounts1 = await createTestPrincipal('accounts', [1]);
  exec = await createTestPrincipal('executive');
  gm = await createTestPrincipal('general_manager', [E]);
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into items (id, sku, name, category, hsn, unit, is_dcr, specs_json) values
        (${ids.module}, 'FN-MODULE', 'finance test module', 'solar_module', '8541', 'nos', true,
         ${tx.json({ wp: 540 })}),
        (${ids.cable}, 'FN-CABLE', 'finance test cable', 'cable', '8544', 'metre', false, '{}'::jsonb)
        on conflict (id) do nothing`;
      await tx`insert into tax_rates (id, item_id, rate_pct, effective_from, source_ref) values
        (${ids.rateModule}, ${ids.module}, 12.00, '2026-04-01', 'finance test'),
        (${ids.rateCable}, ${ids.cable}, 18.00, '2026-04-01', 'finance test')`;
    }),
  );
});

afterAll(async () => {
  await removeFinanceRows();
  await closeDb();
});

/**
 * A dealer's order of company 4, the dealer's relationship there owned by `owner` in their team,
 * with two lines: 5 modules at ₹12,000 with 12% GST and 10 metres of cable at ₹85.50 with 18%,
 * within the state. Totals: ₹60,855.00 taxable, ₹3,676.95 CGST and SGST each, ₹68,208.90 rounded
 * to ₹68,209.00. A dealer's order has no lead, so its segment is dealer_wholesale.
 */
async function order(
  state: 'draft' | 'confirmed' | 'cancelled' = 'confirmed',
  owner: Principal = lc,
): Promise<string> {
  const account = newId();
  const id = newId();
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into accounts (id, type, name, created_by)
        values (${account}, 'dealer', 'Finance test dealer', ${owner.id})`;
      await tx`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
        values (${newId()}, ${account}, ${E}, ${owner.id}, ${owner.teamId ?? null}, ${owner.id})`;
      const confirmed = state === 'draft' ? null : new Date();
      await tx`insert into sales_orders (id, entity_id, so_no, fy, account_id, account_type, tier_id,
                 place_of_supply_state, supply_kind, state, subtotal, cgst, sgst, igst, tax_total,
                 round_off, grand_total, confirmed_at, confirmed_by, cancel_reason, created_by)
        values (${id}, ${E}, ${`FN/SO/2026-27/${id.slice(-8)}`}, '2026-27', ${account}, 'dealer',
                ${tierId('dealer')}, '08', 'intra', ${state}, 60855.00, 3676.95, 3676.95, 0, 7353.90,
                0.10, 68209.00, ${confirmed}, ${confirmed === null ? null : owner.id},
                ${state === 'cancelled' ? 'finance test' : null}, ${owner.id})`;
      await tx`insert into sales_order_lines (id, entity_id, sales_order_id, position, item_id, sku, description,
                 unit, qty, unit_price, hsn, tax_rate_id, tax_rate_pct, taxable_value, cgst, sgst, igst, line_total)
        values (${newId()}, ${E}, ${id}, 1, ${ids.module}, 'FN-MODULE', 'finance test module', 'nos', 5,
                12000.00, '8541', ${ids.rateModule}, 12.00, 60000.00, 3600.00, 3600.00, 0, 67200.00),
               (${newId()}, ${E}, ${id}, 2, ${ids.cable}, 'FN-CABLE', 'finance test cable', 'metre', 10,
                85.50, '8544', ${ids.rateCable}, 18.00, 855.00, 76.95, 76.95, 0, 1008.90)`;
    }),
  );
  return id;
}

function run<T>(principal: Principal, command: AnyCommand, input: unknown): Promise<T> {
  madeBy.add(principal.id);
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  ) as Promise<T>;
}

async function failure(
  principal: Principal,
  command: AnyCommand,
  input: unknown,
): Promise<{ code?: string | undefined; reason?: unknown; stage?: string | undefined }> {
  const error: unknown = await run(principal, command, input).then(
    () => undefined,
    (e: unknown) => e,
  );
  const e = error as { code?: string; details?: { reason?: unknown } } | undefined;
  return { code: e?.code, reason: e?.details?.reason, stage: failureOf(error)?.stage };
}

async function eventsOf(aggregateId: string): Promise<{ type: string; payload: unknown }[]> {
  const rows = await asOutboxPublisher(
    (p) => p<{ type: string; payload_json: unknown }[]>`
      select type, payload_json from outbox_events where aggregate_id = ${aggregateId}
       order by created_at, type`,
  );
  return rows.map((r) => ({ type: r.type, payload: r.payload_json }));
}

async function orderLines(orderId: string): Promise<Record<string, unknown>[]> {
  return asMigrator(
    (m) => m<Record<string, unknown>[]>`
      select position, item_id, kit_id, sku, description, unit, qty::text, unit_price::text, hsn,
             works_contract, tax_rate_id, tax_rate_pct::text, composite_rule_id,
             goods_rate_pct::text, services_rate_pct::text, taxable_value::text,
             goods_taxable::text, services_taxable::text, cgst::text, sgst::text, igst::text,
             line_total::text
        from sales_order_lines where sales_order_id = ${orderId} order by position`,
  );
}

async function proformaLines(proformaId: string): Promise<Record<string, unknown>[]> {
  return asMigrator(
    (m) => m<Record<string, unknown>[]>`
      select position, item_id, kit_id, sku, description, unit, qty::text, unit_price::text, hsn,
             works_contract, tax_rate_id, tax_rate_pct::text, composite_rule_id,
             goods_rate_pct::text, services_rate_pct::text, taxable_value::text,
             goods_taxable::text, services_taxable::text, cgst::text, sgst::text, igst::text,
             line_total::text
        from proforma_lines where proforma_id = ${proformaId} order by position`,
  );
}

const serialOf = (no: string): number => Number(no.split('/').at(-1));

describe('finance.proforma.issue (FIN-01)', () => {
  it('issues a proforma of a confirmed order with its lines, tax and totals copied, numbered from the company series', async () => {
    const orderId = await order();
    const proforma = await run<ProformaDto>(accounts, issueProforma, { entityId: E, orderId });
    expect(proforma.proformaNo).toMatch(/^[A-Z]+\/PI\/\d{4}-\d{2}\/\d{4,}$/);
    expect(proforma).toMatchObject({
      orderId,
      state: 'issued',
      placeOfSupplyState: '08',
      supplyKind: 'intra',
      totals: {
        subtotal: '60855.00',
        cgst: '3676.95',
        sgst: '3676.95',
        igst: '0.00',
        taxTotal: '7353.90',
        roundOff: '0.10',
        grandTotal: '68209.00',
      },
      cancelledAt: null,
    });
    expect(proforma.lines).toHaveLength(2);
    expect(await proformaLines(proforma.id)).toEqual(await orderLines(orderId));
    expect(await eventsOf(proforma.id)).toEqual([
      { type: 'finance.proforma.issued', payload: { orderId, lineCount: 2, v: 1 } },
      {
        type: 'print.document.requested',
        payload: { documentType: 'proforma', documentId: proforma.id, version: 1, v: 1 },
      },
    ]);
  });

  it('is forbidden to a Lead Converter and to Accounts of another company', async () => {
    const orderId = await order();
    expect(await failure(lc, issueProforma, { entityId: E, orderId })).toMatchObject({
      code: 'forbidden',
    });
    expect(await failure(gm, issueProforma, { entityId: E, orderId })).toMatchObject({
      code: 'forbidden',
    });
    // Accounts of company 1, naming company 4 outside the request.
    expect(await failure(accounts1, issueProforma, { entityId: E, orderId })).toMatchObject({
      code: 'forbidden',
    });
    // Company 1 named, the order being company 4's: no such order there.
    expect(await failure(accounts1, issueProforma, { entityId: 1, orderId })).toMatchObject({
      code: 'not_found',
      reason: 'order_missing',
    });
  });

  it('refuses a draft or cancelled order', async () => {
    for (const state of ['draft', 'cancelled'] as const) {
      const orderId = await order(state);
      expect(await failure(accounts, issueProforma, { entityId: E, orderId })).toMatchObject({
        code: 'conflict',
        reason: 'proforma_order_not_confirmed',
      });
    }
  });

  it('keeps one live proforma per order; a cancelled one keeps its number and the next takes a new one', async () => {
    const orderId = await order();
    const first = await run<ProformaDto>(accounts, issueProforma, { entityId: E, orderId });
    expect(await failure(accounts, issueProforma, { entityId: E, orderId })).toMatchObject({
      code: 'conflict',
      reason: 'proforma_already_issued',
    });
    const cancelled = await run<ProformaDto>(accounts, cancelProforma, {
      entityId: E,
      proformaId: first.id,
      reason: 'The customer asked for a new date',
    });
    expect(cancelled).toMatchObject({
      proformaNo: first.proformaNo,
      state: 'cancelled',
      cancelReason: 'The customer asked for a new date',
    });
    const second = await run<ProformaDto>(accounts, issueProforma, { entityId: E, orderId });
    expect(second.proformaNo).not.toBe(first.proformaNo);
    expect(serialOf(second.proformaNo)).toBeGreaterThan(serialOf(first.proformaNo));
    const both = await asPrincipal(accounts, (ctx) => readOrderProformas(ctx, E, orderId));
    expect(both.map((p) => [p.proformaNo, p.state])).toEqual([
      [second.proformaNo, 'issued'],
      [first.proformaNo, 'cancelled'],
    ]);
  });

  it('never works a price or a rate out again: a later rate change leaves the proformas as the order holds them', async () => {
    const orderId = await order();
    const before = await run<ProformaDto>(accounts, issueProforma, { entityId: E, orderId });
    // The module's GST rate and its stored row change after the order was made.
    const today = istCalendarDate(new Date());
    const yesterday = istCalendarDate(new Date(Date.now() - 86_400_000));
    // Put back whatever the assertions below do (review finding 10).
    onTestFinished(() =>
      asMigrator((m) =>
        m.begin(async (tx) => {
          await withoutTriggers(tx);
          await tx`delete from tax_rates where id = ${ids.rateLater}`;
          await tx`update tax_rates set effective_to = null where id = ${ids.rateModule}`;
        }),
      ),
    );
    await asMigrator((m) =>
      m.begin(async (tx) => {
        await tx`update tax_rates set effective_to = ${yesterday} where id = ${ids.rateModule}`;
        await tx`insert into tax_rates (id, item_id, rate_pct, effective_from, source_ref)
                  values (${ids.rateLater}, ${ids.module}, 28.00, ${today}, 'finance test')`;
      }),
    );
    await run(accounts, cancelProforma, {
      entityId: E,
      proformaId: before.id,
      reason: 'Issued again',
    });
    const after = await run<ProformaDto>(accounts, issueProforma, { entityId: E, orderId });
    expect(after.lines).toEqual(before.lines);
    expect(after.totals).toEqual(before.totals);
    expect(after.lines[0]).toMatchObject({ taxRateId: ids.rateModule, taxRatePct: '12.00' });
    expect(await proformaLines(after.id)).toEqual(await orderLines(orderId));
  });

  it('numbers 20 proformas issued at once with no gap, a refused issue giving its number back', async () => {
    const orders = await Promise.all(Array.from({ length: 16 }, () => order()));
    const [start] = await asMigrator(
      (m) => m<{ next: number | null }[]>`
        select max(next_no) as next from document_sequences
         where entity_id = ${E} and doc_type = 'proforma'`,
    );
    // Sixteen orders, four of them asked for twice at once: one of each pair is refused.
    const targets = [...orders, ...orders.slice(0, 4)];
    const results = await Promise.allSettled(
      targets.map((orderId) => run<ProformaDto>(accounts, issueProforma, { entityId: E, orderId })),
    );
    const issued = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    const refused = results.flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []));
    expect(issued).toHaveLength(16);
    expect(refused).toHaveLength(4);
    for (const e of refused) {
      expect(e).toMatchObject({ code: 'conflict', details: { reason: 'proforma_already_issued' } });
    }
    const serials = issued.map((p) => serialOf(p.proformaNo)).sort((a, b) => a - b);
    const first = start?.next ?? 1;
    expect(serials).toEqual(Array.from({ length: 16 }, (_, i) => first + i));
    const [end] = await asMigrator(
      (m) => m<{ next: number }[]>`
        select next_no as next from document_sequences
         where entity_id = ${E} and doc_type = 'proforma' order by next_no desc limit 1`,
    );
    expect(end?.next).toBe(first + 16);
  });
});

describe('finance.proforma.cancel', () => {
  it('is forbidden to a Lead Converter and to Accounts of another company, and needs a reason', async () => {
    const orderId = await order();
    const proforma = await run<ProformaDto>(accounts, issueProforma, { entityId: E, orderId });
    const input = { entityId: E, proformaId: proforma.id, reason: 'Wrong address' };
    expect(await failure(lc, cancelProforma, input)).toMatchObject({ code: 'forbidden' });
    expect(await failure(accounts1, cancelProforma, input)).toMatchObject({ code: 'forbidden' });
    expect(await failure(accounts1, cancelProforma, { ...input, entityId: 1 })).toMatchObject({
      code: 'not_found',
      reason: 'proforma_missing',
    });
    expect(await failure(accounts, cancelProforma, { ...input, reason: ' ' })).toMatchObject({
      code: 'validation_failed',
    });
  });

  it('cancels once', async () => {
    const orderId = await order();
    const proforma = await run<ProformaDto>(accounts, issueProforma, { entityId: E, orderId });
    const input = { entityId: E, proformaId: proforma.id, reason: 'Wrong address' };
    await run(exec, cancelProforma, input);
    expect(await failure(accounts, cancelProforma, input)).toMatchObject({
      code: 'conflict',
      reason: 'proforma_transition_not_allowed',
    });
    expect((await eventsOf(proforma.id)).map((e) => e.type)).toEqual([
      'finance.proforma.issued',
      'print.document.requested',
      'finance.proforma.cancelled',
      // Printed again with "Cancelled" across it.
      'print.document.requested',
    ]);
  });
});

describe('finance.milestone.plan and finance.milestone.plan_confirmed (FIN-01, question 6 (a))', () => {
  it('plans the named default by hand: half on confirmation, due now, half before dispatch, summing to the total', async () => {
    const orderId = await order();
    const planned = await run<PlannedMilestonesDto>(accounts, planMilestonesByHand, {
      entityId: E,
      orderId,
    });
    const today = istCalendarDate(new Date());
    expect(planned.templateVersion).toBeNull();
    expect(
      planned.milestones.map((m) => [
        m.key,
        m.label,
        m.percent,
        m.amount,
        m.dueRule,
        m.state,
        m.dueOn,
      ]),
    ).toEqual([
      ['advance', 'Advance', '50.00', '34105.00', 'on_confirmation', 'due', today],
      ['balance', 'Balance', '50.00', '34104.00', 'before_dispatch', 'pending', null],
    ]);
    expect(await eventsOf(orderId)).toContainEqual({
      type: 'finance.milestones.planned',
      payload: { count: 2, dueCount: 1, templateVersion: null, v: 1 },
    });
    expect(await failure(accounts, planMilestonesByHand, { entityId: E, orderId })).toMatchObject({
      code: 'conflict',
      reason: 'milestones_already_planned',
    });
  });

  it('is forbidden to a Lead Converter and to Accounts of another company, and refuses a draft order', async () => {
    const orderId = await order();
    expect(await failure(lc, planMilestonesByHand, { entityId: E, orderId })).toMatchObject({
      code: 'forbidden',
    });
    expect(await failure(accounts1, planMilestonesByHand, { entityId: E, orderId })).toMatchObject({
      code: 'forbidden',
    });
    expect(await failure(accounts1, planMilestonesByHand, { entityId: 1, orderId })).toMatchObject({
      code: 'not_found',
      reason: 'order_missing',
    });
    const draft = await order('draft');
    expect(
      await failure(accounts, planMilestonesByHand, { entityId: E, orderId: draft }),
    ).toMatchObject({ code: 'conflict', reason: 'milestones_order_not_confirmed' });
    // A person never runs the platform's planning.
    expect(
      await failure(accounts, planConfirmedMilestones, { entityId: E, orderId }),
    ).toMatchObject({ code: 'forbidden' });
  });

  it('plans from the platform on confirmation once, reading nothing it may not, and skips an order no longer confirmed', async () => {
    const orderId = await order();
    expect(
      await run<PlanConfirmedOutcome>(workers(), planConfirmedMilestones, { entityId: E, orderId }),
    ).toEqual({ outcome: 'planned', count: 2 });
    expect(
      await run<PlanConfirmedOutcome>(workers(), planConfirmedMilestones, { entityId: E, orderId }),
    ).toEqual({ outcome: 'already_planned', count: 0 });
    // The platform reads no milestone itself (no finance.read): a repeat finds them through the
    // definer alone.
    expect(await asPrincipal(workers(), (ctx) => readOrderMilestones(ctx, E, orderId))).toEqual([]);
    const seen = await asPrincipal(accounts, (ctx) => readOrderMilestones(ctx, E, orderId));
    expect(seen.map((m) => m.amount)).toEqual(['34105.00', '34104.00']);
    const cancelled = await order('cancelled');
    expect(
      await run<PlanConfirmedOutcome>(workers(), planConfirmedMilestones, {
        entityId: E,
        orderId: cancelled,
      }),
    ).toEqual({ outcome: 'not_confirmed', count: 0 });
    // Another company's order is not one of the platform's request for company 4.
    expect(
      await failure(workers(), planConfirmedMilestones, { entityId: 1, orderId }),
    ).toMatchObject({ code: 'forbidden' });
  });

  it('plans from the current version of the company terms: fixed amounts first, percentages of the rest, the last taking the remainder', async () => {
    const steps = [
      {
        key: 'booking',
        label: 'Booking amount',
        percent: null,
        amount: '5000.00',
        dueRule: 'on_confirmation',
        dueDays: null,
        loanGate: 'none',
      },
      {
        key: 'material',
        label: 'Before the material leaves',
        percent: '60.00',
        amount: null,
        dueRule: 'before_dispatch',
        dueDays: null,
        loanGate: 'none',
      },
      {
        key: 'balance',
        label: 'Balance after the invoice',
        percent: '40.00',
        amount: null,
        dueRule: 'days_after_invoice',
        dueDays: 30,
        loanGate: 'disbursed',
      },
    ];
    onTestFinished(removeTerms);
    const v1 = await run<MilestoneTemplateDto>(exec, publishPaymentTerms, {
      entityId: E,
      segment: 'dealer_wholesale',
      steps: steps.slice(1).map((s) => ({ ...s, percent: '50.00' })),
    });
    const v2 = await run<MilestoneTemplateDto>(exec, publishPaymentTerms, {
      entityId: E,
      segment: 'dealer_wholesale',
      steps,
    });
    expect([v1.version, v2.version]).toEqual([1, 2]);
    const orderId = await order();
    const planned = await run<PlannedMilestonesDto>(accounts, planMilestonesByHand, {
      entityId: E,
      orderId,
    });
    expect(planned.templateVersion).toBe(2);
    // ₹68,209 less the ₹5,000 booking leaves ₹63,209: 60% is ₹37,925.40, to the rupee ₹37,925,
    // and the last takes ₹25,284. The order has no loan to hold anything back, and the invoice has
    // not come.
    expect(planned.milestones.map((m) => [m.key, m.amount, m.state])).toEqual([
      ['booking', '5000.00', 'due'],
      ['material', '37925.00', 'pending'],
      ['balance', '25284.00', 'pending'],
    ]);
    const sum = planned.milestones.reduce((s, m) => s + Math.round(Number(m.amount) * 100), 0);
    expect(sum).toBe(6820900);
  });

  it('refuses terms whose fixed amounts pass the order total by hand; the platform records it, tells Accounts and holds the dispatch', async () => {
    onTestFinished(removeTerms);
    await run(exec, publishPaymentTerms, {
      entityId: E,
      segment: 'dealer_wholesale',
      steps: [
        {
          key: 'booking',
          label: 'Booking amount',
          percent: null,
          amount: '90000.00',
          dueRule: 'on_confirmation',
          dueDays: null,
          loanGate: 'none',
        },
        {
          key: 'balance',
          label: 'Balance',
          percent: '100.00',
          amount: null,
          dueRule: 'before_dispatch',
          dueDays: null,
          loanGate: 'none',
        },
      ],
    });
    const orderId = await order();
    expect(await failure(accounts, planMilestonesByHand, { entityId: E, orderId })).toMatchObject({
      code: 'validation_failed',
      reason: 'milestone_amounts_exceed_total',
    });
    // The platform's plan on confirmation is not lost (review finding 3): recorded on the order,
    // told to Accounts, and the dispatch waits.
    expect(
      await run<PlanConfirmedOutcome>(workers(), planConfirmedMilestones, { entityId: E, orderId }),
    ).toEqual({ outcome: 'failed', count: 0 });
    expect(await eventsOf(orderId)).toContainEqual({
      type: 'finance.milestones.plan_failed',
      payload: { reason: 'milestone_amounts_exceed_total', v: 1 },
    });
    const tab = await asPrincipal(accounts, (ctx) =>
      readOrderPayments(ctx, { entityId: E, orderId }),
    );
    expect(tab).toMatchObject({
      planFailure: 'milestone_amounts_exceed_total',
      dispatchGate: 'open',
      canPlan: true,
    });
    // A repeat records nothing new.
    expect(
      await run<PlanConfirmedOutcome>(workers(), planConfirmedMilestones, { entityId: E, orderId }),
    ).toEqual({ outcome: 'failed', count: 0 });
    // The Executive changes the terms, Accounts plan the order by hand, and the failure is gone.
    await run(exec, publishPaymentTerms, {
      entityId: E,
      segment: 'dealer_wholesale',
      steps: [
        {
          key: 'whole',
          label: 'Whole amount',
          percent: '100.00',
          amount: null,
          dueRule: 'on_confirmation',
          dueDays: null,
          loanGate: 'none',
        },
      ],
    });
    await run(accounts, planMilestonesByHand, { entityId: E, orderId });
    const after = await asPrincipal(accounts, (ctx) =>
      readOrderPayments(ctx, { entityId: E, orderId }),
    );
    expect(after).toMatchObject({ planFailure: null, dispatchGate: 'clear', canPlan: false });
  });

  it('holds the dispatch of a confirmed order with no payments planned yet, under the standard terms', async () => {
    const orderId = await order();
    const tab = await asPrincipal(accounts, (ctx) =>
      readOrderPayments(ctx, { entityId: E, orderId }),
    );
    expect(tab).toMatchObject({ milestones: [], planFailure: null, dispatchGate: 'open' });
    const draft = await order('draft');
    const forDraft = await asPrincipal(accounts, (ctx) =>
      readOrderPayments(ctx, { entityId: E, orderId: draft }),
    );
    expect(forDraft.dispatchGate).toBe('clear');
  });
});

describe('finance.terms.publish (question 6 (a))', () => {
  it('is the Executive’s for every company: refused to Accounts, a GM and a request outside the company', async () => {
    const steps = [
      {
        key: 'advance',
        label: 'Advance',
        percent: '100.00',
        amount: null,
        dueRule: 'on_confirmation',
        dueDays: null,
        loanGate: 'none',
      },
    ];
    const input = { entityId: E, segment: 'farmer_pumps', steps };
    expect(await failure(accounts, publishPaymentTerms, input)).toMatchObject({
      code: 'forbidden',
    });
    expect(await failure(gm, publishPaymentTerms, input)).toMatchObject({ code: 'forbidden' });
    // The Executive acting for company 1 only: company 4 is outside the request.
    const execIn1 = { ...exec, entityIds: [1] };
    expect(await failure(execIn1, publishPaymentTerms, input)).toMatchObject({
      code: 'forbidden',
    });
    expect(
      await failure(exec, publishPaymentTerms, {
        ...input,
        steps: [{ ...steps[0], percent: '90.00' }],
      }),
    ).toMatchObject({ code: 'validation_failed' });
  });
});

describe('finance.milestone.waive', () => {
  it('is the Executive’s alone, with a reason, once; a dispatch then no longer waits for it', async () => {
    const orderId = await order();
    const planned = await run<PlannedMilestonesDto>(accounts, planMilestonesByHand, {
      entityId: E,
      orderId,
    });
    const balance = planned.milestones.find((m) => m.key === 'balance');
    const input = { entityId: E, milestoneId: balance?.id ?? '', reason: 'Settled in person' };
    expect(await failure(accounts, waiveMilestone, input)).toMatchObject({ code: 'forbidden' });
    expect(await failure(lc, waiveMilestone, input)).toMatchObject({ code: 'forbidden' });
    // The Executive acting for company 1 only: company 4 is outside the request.
    expect(await failure({ ...exec, entityIds: [1] }, waiveMilestone, input)).toMatchObject({
      code: 'forbidden',
    });
    const gate = (p: Principal) =>
      asPrincipal(p, async ({ tx }) => {
        const [row] = (await tx.execute(
          sql`select app.order_dispatch_payment_gate(${orderId}::uuid) as gate`,
        )) as unknown as { gate: string | null }[];
        return row?.gate;
      });
    expect(await gate(accounts)).toBe('open');
    const waived = await run<PaymentMilestoneDto>(exec, waiveMilestone, input);
    expect(waived).toMatchObject({ state: 'waived', waiveReason: 'Settled in person' });
    expect(waived.waivedAt).not.toBeNull();
    expect(await gate(accounts)).toBe('clear');
    expect(await failure(exec, waiveMilestone, input)).toMatchObject({
      code: 'conflict',
      reason: 'payment_milestone_transition_not_allowed',
    });
    expect(await eventsOf(balance?.id ?? '')).toEqual([
      { type: 'finance.milestone.waived', payload: { orderId, v: 1 } },
    ]);
  });
});

describe('finance.read (phase5 §4): who reads an order’s proformas and milestones', () => {
  it('the LC their own order, their Sales Lead the team’s, Accounts and the GM the company’s; another LC none', async () => {
    const orderId = await order();
    await run(accounts, issueProforma, { entityId: E, orderId });
    await run(accounts, planMilestonesByHand, { entityId: E, orderId });
    const counts = async (p: Principal) => [
      (await asPrincipal(p, (ctx) => readOrderProformas(ctx, E, orderId))).length,
      (await asPrincipal(p, (ctx) => readOrderMilestones(ctx, E, orderId))).length,
    ];
    expect(await counts(lc)).toEqual([1, 2]);
    expect(await counts(salesLead)).toEqual([1, 2]);
    expect(await counts(accounts)).toEqual([1, 2]);
    expect(await counts(gm)).toEqual([1, 2]);
    expect(await counts(exec)).toEqual([1, 2]);
    expect(await counts(otherLc)).toEqual([0, 0]);
    expect(await counts(principalFor('tele_caller_cc', [E], { id: lc.id, teamId }))).toEqual([
      0, 0,
    ]);
  });
});

/** A rendered PDF of company 4 as the worker records one (`files.document.record`). */
async function renderedFile(
  purpose: 'proforma_pdf' | 'quote_pdf' = 'proforma_pdf',
): Promise<string> {
  const id = newId();
  await asMigrator(
    (
      m,
    ) => m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
             values (${id}, ${E}, ${purpose}, 'local', ${`${String(E)}/${purpose}/${id}`}, 'file.pdf',
                     'application/pdf', 10, ${'d'.repeat(64)}, 'ready', ${SYSTEM_WORKERS_PRINCIPAL_ID})`,
  );
  return id;
}

describe('the proforma PDF (finance.proforma.pdf.attach and its print loader)', () => {
  it('is attached by the render worker alone: refused to Accounts, the Executive and an agent', async () => {
    const orderId = await order();
    const proforma = await run<ProformaDto>(accounts, issueProforma, { entityId: E, orderId });
    const input = { entityId: E, proformaId: proforma.id, fileId: await renderedFile() };
    for (const who of [accounts, exec, principalFor('agent:orchestrator', [E])]) {
      expect(await failure(who, attachProformaPdf, input)).toMatchObject({ code: 'forbidden' });
    }
    // The worker acting for company 1: company 4 is outside the request.
    const workers1 = { ...workers(), entityIds: [1] };
    expect(await failure(workers1, attachProformaPdf, input)).toMatchObject({ code: 'forbidden' });
  });

  it('attaches a ready proforma PDF once, refusing another file or another purpose, and the reader opens it', async () => {
    const orderId = await order();
    const proforma = await run<ProformaDto>(accounts, issueProforma, { entityId: E, orderId });
    const file = await renderedFile();
    expect(
      await failure(workers(), attachProformaPdf, {
        entityId: E,
        proformaId: proforma.id,
        fileId: await renderedFile('quote_pdf'),
      }),
    ).toMatchObject({ code: 'conflict', reason: 'proforma_pdf_mismatch' });
    await run(workers(), attachProformaPdf, { entityId: E, proformaId: proforma.id, fileId: file });
    // A delivery that runs again attaches the same file and nothing else.
    await run(workers(), attachProformaPdf, { entityId: E, proformaId: proforma.id, fileId: file });
    expect(
      await failure(workers(), attachProformaPdf, {
        entityId: E,
        proformaId: proforma.id,
        fileId: await renderedFile(),
      }),
    ).toMatchObject({ code: 'conflict', reason: 'proforma_pdf_mismatch' });
    const [seen] = await asPrincipal(lc, (ctx) => readOrderProformas(ctx, E, orderId));
    expect(seen?.pdfFileId).toBe(file);
    // The Lead Converter reads the file with the proforma; another Lead Converter does not.
    const fileRows = (p: Principal) =>
      asPrincipal(p, async ({ tx }) => tx.execute(sql`select id from files where id = ${file}`));
    expect(await fileRows(lc)).toHaveLength(1);
    expect(await fileRows(otherLc)).toHaveLength(0);
  });

  it('loads the proforma for the worker with its lines, customer and payments, and for no one else', async () => {
    const orderId = await order();
    const proforma = await run<ProformaDto>(accounts, issueProforma, { entityId: E, orderId });
    await run(workers(), planConfirmedMilestones, { entityId: E, orderId });
    const printed = await asPrincipal(workers(), (ctx) => loadProformaForPrint(ctx, proforma.id));
    expect(printed).toMatchObject({
      proformaNo: proforma.proformaNo,
      grandTotal: '68209.00',
      customerName: 'Finance test dealer',
      customerGstin: null,
    });
    expect(printed.lines.map((l) => [l.hsn, l.unitPrice, l.taxRatePct])).toEqual([
      ['8541', '12000.00', '12.00'],
      ['8544', '85.50', '18.00'],
    ]);
    expect(printed.milestones.map((m) => m.amount)).toEqual(['34105.00', '34104.00']);
    await expect(
      asPrincipal(accounts, (ctx) => loadProformaForPrint(ctx, proforma.id)),
    ).rejects.toThrow();
  });
});

describe('the Payments tab and Settings › Payment terms reads', () => {
  it('answer the order’s payments and what each reader may do, and refuse a reader without finance.read', async () => {
    const orderId = await order();
    await run(accounts, issueProforma, { entityId: E, orderId });
    const tab = (p: Principal) =>
      asPrincipal(p, (ctx) => readOrderPayments(ctx, { entityId: E, orderId }));
    const forAccounts = await tab(accounts);
    expect(forAccounts).toMatchObject({
      // Confirmed with no payments planned: its dispatch waits (review finding 3).
      dispatchGate: 'open',
      canIssue: false,
      canCancelProforma: true,
      canPlan: true,
      canWaive: false,
    });
    expect(forAccounts.proformas).toHaveLength(1);
    expect(await tab(lc)).toMatchObject({ canIssue: false, canPlan: false, canWaive: false });
    expect(await tab(exec)).toMatchObject({ canWaive: true });
    await expect(tab(principalFor('tele_caller_cc', [E], { id: lc.id }))).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      asPrincipal(otherLc, (ctx) => readOrderPayments(ctx, { entityId: E, orderId })),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('lists a company’s terms and the standard terms for the Executive alone', async () => {
    const terms = await asPrincipal(exec, (ctx) => listPaymentTerms(ctx, { entityId: E }));
    expect(terms.defaultSteps.map((s) => s.key)).toEqual(['advance', 'balance']);
    await expect(
      asPrincipal(accounts, (ctx) => listPaymentTerms(ctx, { entityId: E })),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('the platform’s follow-ups of an order (the review of 27-11-2026)', () => {
  it('cancels a cancelled order’s live proforma and waiting payments, once, and prints the proforma again', async () => {
    const orderId = await order();
    const proforma = await run<ProformaDto>(accounts, issueProforma, { entityId: E, orderId });
    await run(workers(), planConfirmedMilestones, { entityId: E, orderId });
    // A person refuses nothing here: only the platform settles it, and only in its own company.
    expect(await failure(accounts, settleCancelledOrder, { entityId: E, orderId })).toMatchObject({
      code: 'forbidden',
    });
    const workers1 = { ...workers(), entityIds: [1] };
    // The worker acting for company 1: company 4 is outside the request.
    expect(await failure(workers1, settleCancelledOrder, { entityId: E, orderId })).toMatchObject({
      code: 'forbidden',
    });
    // Still confirmed: nothing to settle.
    expect(await run(workers(), settleCancelledOrder, { entityId: E, orderId })).toEqual({
      proformaId: null,
      milestones: 0,
    });
    await asMigrator(
      (m) => m`update sales_orders set state = 'cancelled', cancel_reason = 'The customer withdrew'
                where id = ${orderId}`,
    );
    expect(await run(workers(), settleCancelledOrder, { entityId: E, orderId })).toEqual({
      proformaId: proforma.id,
      milestones: 2,
    });
    expect(await run(workers(), settleCancelledOrder, { entityId: E, orderId })).toEqual({
      proformaId: null,
      milestones: 0,
    });
    const [after] = await asPrincipal(accounts, (ctx) => readOrderProformas(ctx, E, orderId));
    expect(after).toMatchObject({ state: 'cancelled', cancelReason: 'The customer withdrew' });
    const milestones = await asPrincipal(accounts, (ctx) => readOrderMilestones(ctx, E, orderId));
    expect(milestones.map((m) => m.state)).toEqual(['cancelled', 'cancelled']);
    expect((await eventsOf(proforma.id)).map((e) => e.type)).toEqual([
      'finance.proforma.issued',
      'print.document.requested',
      'finance.proforma.cancelled',
      'print.document.requested',
    ]);
  });

  it('offers a cancelled proforma’s PDF only once it is printed “Cancelled”', async () => {
    const orderId = await order();
    const proforma = await run<ProformaDto>(accounts, issueProforma, { entityId: E, orderId });
    await run(workers(), attachProformaPdf, {
      entityId: E,
      proformaId: proforma.id,
      fileId: await renderedFile(),
    });
    await run(accounts, cancelProforma, {
      entityId: E,
      proformaId: proforma.id,
      reason: 'Wrong address',
    });
    const read = async () =>
      (await asPrincipal(accounts, (ctx) => readOrderProformas(ctx, E, orderId)))[0]?.pdfFileId;
    expect(await read()).toBeNull();
    const reprint = await renderedFile();
    await run(workers(), attachProformaPdf, {
      entityId: E,
      proformaId: proforma.id,
      fileId: reprint,
    });
    expect(await read()).toBe(reprint);
  });

  it('brings a waiting payment due once its loan no longer holds it, and leaves the others waiting', async () => {
    const orderId = await order();
    const [owner] = await asMigrator(
      (m) => m<{ created_by: string }[]>`select created_by from sales_orders where id = ${orderId}`,
    );
    const held = newId();
    const balance = newId();
    await asMigrator(
      (
        m,
      ) => m`insert into payment_milestones (id, entity_id, sales_order_id, seq, key, label, percent,
                 amount, due_rule, loan_gate, state, created_by) values
               (${held}, ${E}, ${orderId}, 1, 'advance', 'Advance', 50, 34105.00, 'on_confirmation',
                'sanctioned', 'pending', ${owner?.created_by ?? ''}),
               (${balance}, ${E}, ${orderId}, 2, 'balance', 'Balance', 50, 34104.00, 'before_dispatch',
                'none', 'pending', ${owner?.created_by ?? ''})`,
    );
    expect(await failure(accounts, refreshMilestones, { entityId: E, orderId })).toMatchObject({
      code: 'forbidden',
    });
    // The worker acting for company 1: company 4 is outside the request.
    expect(
      await failure({ ...workers(), entityIds: [1] }, refreshMilestones, { entityId: E, orderId }),
    ).toMatchObject({ code: 'forbidden' });
    // J2's loan gate answers that the order has no loan, so nothing holds the advance.
    expect(await run(workers(), refreshMilestones, { entityId: E, orderId })).toEqual({
      fellDue: 1,
    });
    expect(await run(workers(), refreshMilestones, { entityId: E, orderId })).toEqual({
      fellDue: 0,
    });
    const milestones = await asPrincipal(accounts, (ctx) => readOrderMilestones(ctx, E, orderId));
    expect(milestones.map((m) => [m.key, m.state, m.dueOn])).toEqual([
      ['advance', 'due', istCalendarDate(new Date())],
      ['balance', 'pending', null],
    ]);
  });

  it('holds a loan-gated payment while J2’s loan gate holds the order, and brings it due once the loan is sanctioned', async () => {
    onTestFinished(removeTerms);
    await run(exec, publishPaymentTerms, {
      entityId: E,
      segment: 'dealer_wholesale',
      steps: [
        {
          key: 'advance',
          label: 'Advance',
          percent: '30.00',
          amount: null,
          dueRule: 'on_confirmation',
          dueDays: null,
          loanGate: 'sanctioned',
        },
        {
          key: 'balance',
          label: 'Balance',
          percent: '70.00',
          amount: null,
          dueRule: 'before_dispatch',
          dueDays: null,
          loanGate: 'none',
        },
      ],
    });
    await asMigrator(
      (m) => m`insert into lenders (id, entity_id, name, created_by)
                 values (${ids.lender}, ${E}, 'Finance test bank', ${exec.id})
                 on conflict (id) do nothing`,
    );
    const orderId = await order();
    const loan = await run<{ id: string; state: string }>(exec, createCustomerLoan, {
      entityId: E,
      orderId,
      lenderId: ids.lender,
      amount: '50000.00',
    });
    expect(loan.state).toBe('applied');
    // The platform plans on confirmation through J2's own app.order_loan_gate(): the applied loan
    // holds the advance, which would otherwise fall due at once.
    expect(
      await run<PlanConfirmedOutcome>(workers(), planConfirmedMilestones, { entityId: E, orderId }),
    ).toEqual({ outcome: 'planned', count: 2 });
    const states = async () =>
      (await asPrincipal(accounts, (ctx) => readOrderMilestones(ctx, E, orderId))).map((m) => [
        m.key,
        m.state,
      ]);
    expect(await states()).toEqual([
      ['advance', 'pending'],
      ['balance', 'pending'],
    ]);
    expect(await run(workers(), refreshMilestones, { entityId: E, orderId })).toEqual({
      fellDue: 0,
    });
    await run(exec, sanctionCustomerLoan, {
      entityId: E,
      loanId: loan.id,
      sanctionedAmount: '50000.00',
    });
    // The sanction's event names the order the platform's refresh is delivered for.
    expect(await eventsOf(loan.id)).toContainEqual({
      type: 'crm.loan.sanctioned',
      payload: expect.objectContaining({ salesOrderId: orderId, state: 'sanctioned' }),
    });
    expect(await run(workers(), refreshMilestones, { entityId: E, orderId })).toEqual({
      fellDue: 1,
    });
    expect(await states()).toEqual([
      ['advance', 'due'],
      ['balance', 'pending'],
    ]);
  });

  it('tells the company’s Accounts that an order’s payments could not be planned', async () => {
    const orderId = await order();
    const person = await createTestUser([{ entityId: E, roleKey: 'accounts' }]);
    const other = await createTestUser([{ entityId: E, roleKey: 'tele_caller_cc' }]);
    await asMigrator(
      (
        m,
      ) => m`update sales_orders set payment_plan_failure = 'forbidden', payment_plan_failed_at = now()
                where id = ${orderId}`,
    );
    const batch = await run<{ notices: unknown[] }>(workers(), notifyEvent, {
      event: 'finance.milestones.plan_failed',
      entityId: E,
      eventId: newId(),
      orderId,
    });
    expect(batch.notices.length).toBeGreaterThanOrEqual(1);
    const told = await asMigrator(
      (m) => m<{ user_id: string }[]>`select user_id from notifications
                                       where type = 'payments_not_planned' and subject_id = ${orderId}`,
    );
    expect(told.map((r) => r.user_id)).toContain(person.id);
    expect(told.map((r) => r.user_id)).not.toContain(other.id);
  });
});
