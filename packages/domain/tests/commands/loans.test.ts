import { newId, type CustomerLoanDto, type LenderDto, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  tierId,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { createCustomerLoan } from '../../src/commands/crm/loans-create';
import { disburseCustomerLoan } from '../../src/commands/crm/loans-disburse';
import { createLender, updateLender } from '../../src/commands/crm/loans-lenders';
import { rejectCustomerLoan } from '../../src/commands/crm/loans-reject';
import { sanctionCustomerLoan } from '../../src/commands/crm/loans-sanction';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import {
  getOrderLoans,
  listAccountLoans,
  listLenders,
  orderLoanGate,
} from '../../src/queries/crm/loans';

// J2 customer loans (docs/03-roadmap-appendix/phase4.md §6.2): crm.loan.create, .sanction,
// .disburse and .reject with crm.account.write over the customer's relationship in the order's
// company, and crm.lender.create and .update with admin.entities.write. Loans are made in company
// 2 on synthetic orders of this file; company 4 is used, its other lenders switched off for the
// file and back on afterwards, to record a lender's typed name while the company's list is empty.
// Every amount is a synthetic test value, never a client figure.

const E = 2;
const TYPED_E = 4;
const P = '01990000-0000-7000-8000-000000d3';
const fixed = (n: number): string => `${P}${n.toString(16).padStart(4, '0')}`;
const like = `${P}%`;
const ACCOUNT = fixed(0x0001);
const ACCOUNT_TYPED = fixed(0x0002);
const CANCELLED = fixed(0x00ff);
/** An order of company 2 per case, so no case shares another's loan. */
let orderSeq = 0;

let teamId: string;
let caller: Principal;
let otherCaller: Principal;
let gm: Principal;
let gm1: Principal;
let accounts: Principal;
let exec: Principal;
let exec1: Principal;
let lender: LenderDto;
/** Company 4's active lenders of other suites, switched off for this file. */
let switchedOff: string[] = [];

function run(principal: Principal, command: AnyCommand, input: unknown): Promise<unknown> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  );
}

const reason = (r: string) => ({ details: { reason: r } });

async function removeRows(): Promise<void> {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from customer_loans where sales_order_id::text like ${like}`;
      await tx`delete from lenders where name like 'Loan suite %'`;
      await tx`delete from sales_orders where id::text like ${like}`;
      await tx`delete from account_entities where account_id::text like ${like}`;
      await tx`delete from accounts where id::text like ${like}`;
    }),
  );
}

/** A draft order of the file's customer in `entity` (or a cancelled one). */
async function newOrder(entity = E, account = ACCOUNT, state = 'draft'): Promise<string> {
  orderSeq += 1;
  const orderId = state === 'cancelled' ? CANCELLED : fixed(0x0100 + orderSeq);
  await asMigrator(
    (m) => m`insert into sales_orders (id, entity_id, so_no, fy, account_id, tier_id,
               place_of_supply_state, supply_kind, subtotal, cgst, sgst, igst, tax_total, round_off,
               grand_total, state, cancel_reason, created_by)
      values (${orderId}, ${entity}, ${`J2T/2098-99/${orderId.slice(-4)}`}, '2098-99',
              ${account}, ${tierId('dealer')}, '08', 'intra', 0, 0, 0, 0, 0, 0, 0, ${state},
              ${state === 'cancelled' ? 'loan suite cancel' : null}, ${caller.id})`,
  );
  return orderId;
}

const create = (who: Principal, orderId: string, extra: Record<string, unknown> = {}) =>
  run(who, createCustomerLoan, {
    entityId: E,
    orderId,
    lenderId: lender.id,
    amount: '250000.00',
    ...extra,
  }) as Promise<CustomerLoanDto>;

async function eventsOf(
  aggregateId: string,
): Promise<{ type: string; payload: Record<string, unknown> }[]> {
  const rows = await asOutboxPublisher(
    (p) => p<{ type: string; payload_json: Record<string, unknown> }[]>`
      select type, payload_json from outbox_events where aggregate_id = ${aggregateId}
       order by sequence`,
  );
  return rows.map((r) => ({ type: r.type, payload: r.payload_json }));
}

beforeAll(async () => {
  await removeRows();
  teamId = await createTestTeam(E, 'loan team');
  caller = await createTestPrincipal('tele_caller_cc', [E], { teamId });
  otherCaller = await createTestPrincipal('tele_caller_cc', [E], { teamId });
  gm = await createTestPrincipal('general_manager', [E]);
  gm1 = await createTestPrincipal('general_manager', [1]);
  accounts = await createTestPrincipal('accounts', [E]);
  exec = await createTestPrincipal('executive');
  exec1 = await createTestPrincipal('executive', [1]);
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into accounts (id, type, name, created_by) values
        (${ACCOUNT}, 'farm', 'Loan suite customer', ${caller.id}),
        (${ACCOUNT_TYPED}, 'farm', 'Loan suite typed customer', ${caller.id})`;
      await tx`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by) values
        (${newId()}, ${ACCOUNT}, ${E}, ${caller.id}, ${teamId}, ${caller.id}),
        (${newId()}, ${ACCOUNT_TYPED}, ${TYPED_E}, ${caller.id}, null, ${caller.id})`;
      const others = await tx<{ id: string }[]>`
        update lenders set is_active = false where entity_id = ${TYPED_E} and is_active
        returning id`;
      switchedOff = others.map((r) => r.id);
    }),
  );
  lender = (await run(exec, createLender, {
    entityId: E,
    name: `Loan suite bank ${newId().slice(-6)}`,
  })) as LenderDto;
});

afterAll(async () => {
  await removeRows();
  if (switchedOff.length > 0) {
    await asMigrator((m) => m`update lenders set is_active = true where id in ${m(switchedOff)}`);
  }
  await closeDb();
});

describe('crm.loan.create', () => {
  it('records an applied loan on the order, audited, with an event of ids and the state', async () => {
    const orderId = await newOrder();
    const loan = await create(gm, orderId, { reference: 'HDFC/LN/2026/0042' });
    expect(loan).toMatchObject({
      entityId: E,
      accountId: ACCOUNT,
      salesOrderId: orderId,
      lenderId: lender.id,
      lenderName: lender.name,
      amount: '250000.00',
      state: 'applied',
      sanctionedAmount: null,
      reference: 'HDFC/LN/2026/0042',
      gates: { dispatch: 'disbursed' },
    });
    expect(await eventsOf(loan.id)).toEqual([
      {
        type: 'crm.loan.created',
        payload: { accountId: ACCOUNT, salesOrderId: orderId, state: 'applied', v: 1 },
      },
    ]);
    const [row] = await asMigrator(
      (m) => m<{ after: Record<string, unknown> }[]>`
        select after_json as after from audit_logs
         where command = 'crm.loan.create' and outcome = 'ok' and aggregate_id = ${loan.id}`,
    );
    expect(row?.after).toMatchObject({
      loanState: 'applied',
      loanAmount: '250000.00',
      lenderName: lender.name,
      dispatchGate: 'disbursed',
    });
  });

  it('is open to the owner of the relationship and refused to Accounts and another caller', async () => {
    const orderId = await newOrder();
    await expect(create(accounts, orderId)).rejects.toMatchObject({ code: 'forbidden' });
    // Another caller holds crm.account.write at own scope, over relationships they do not own.
    await expect(create(otherCaller, orderId)).rejects.toMatchObject(reason('order_missing'));
    await expect(create(caller, orderId)).resolves.toMatchObject({ state: 'applied' });
  });

  it('refuses a company outside the request', async () => {
    const orderId = await newOrder();
    await expect(create(gm1, orderId)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a second active loan on the order, also two at the same moment', async () => {
    const orderId = await newOrder();
    const results = await Promise.allSettled([create(gm, orderId), create(gm, orderId)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected');
    expect(refused?.status === 'rejected' ? refused.reason : undefined).toMatchObject({
      code: 'conflict',
      ...reason('loan_active_exists'),
    });
    await expect(create(gm, orderId)).rejects.toMatchObject(reason('loan_active_exists'));
  });

  it('refuses a cancelled order, a lender off the list, and an amount of nothing', async () => {
    const cancelled = await newOrder(E, ACCOUNT, 'cancelled');
    await expect(create(gm, cancelled)).rejects.toMatchObject(reason('loan_order_cancelled'));
    const orderId = await newOrder();
    const closed = (await run(exec, createLender, {
      entityId: E,
      name: `Loan suite closed ${newId().slice(-6)}`,
    })) as LenderDto;
    await run(exec, updateLender, { entityId: E, lenderId: closed.id, isActive: false });
    await expect(create(gm, orderId, { lenderId: closed.id })).rejects.toMatchObject(
      reason('loan_lender_missing'),
    );
    await expect(
      create(gm, orderId, { lenderId: null, lenderName: 'Loan suite typed bank' }),
    ).rejects.toMatchObject(reason('loan_lender_from_list'));
    await expect(create(gm, orderId, { amount: '0.00' })).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it("takes a lender's name typed once while the company's list is empty", async () => {
    const orderId = await newOrder(TYPED_E, ACCOUNT_TYPED);
    const loan = (await run(exec, createCustomerLoan, {
      entityId: TYPED_E,
      orderId,
      lenderName: 'Loan suite typed bank',
      amount: '120000.00',
      gates: { dispatch: 'sanctioned' },
    })) as CustomerLoanDto;
    expect(loan).toMatchObject({
      lenderId: null,
      lenderName: 'Loan suite typed bank',
      gates: { dispatch: 'sanctioned' },
    });
  });
});

describe('crm.loan.sanction, .disburse and .reject', () => {
  it('sanction needs an amount above zero, then disbursal releases the dispatch', async () => {
    const orderId = await newOrder();
    const loan = await create(caller, orderId);
    expect(await asPrincipal(gm, (ctx) => orderLoanGate(ctx, orderId))).toMatchObject({
      loanId: loan.id,
      dispatch: 'pending',
    });
    await expect(
      run(gm, sanctionCustomerLoan, { entityId: E, loanId: loan.id, sanctionedAmount: '0.00' }),
    ).rejects.toMatchObject({ code: 'validation_failed', ...reason('loan_amount_missing') });
    await expect(
      run(gm, disburseCustomerLoan, { entityId: E, loanId: loan.id }),
    ).rejects.toMatchObject({
      code: 'conflict',
      ...reason('customer_loan_transition_not_allowed'),
    });

    const sanctioned = (await run(gm, sanctionCustomerLoan, {
      entityId: E,
      loanId: loan.id,
      sanctionedAmount: '240000.00',
      reference: 'SBI-778899001122',
    })) as CustomerLoanDto;
    expect(sanctioned).toMatchObject({
      state: 'sanctioned',
      sanctionedAmount: '240000.00',
      reference: 'SBI-778899001122',
    });
    // The dispatch waits for the disbursal: the sanction releases nothing.
    expect((await eventsOf(loan.id)).map((e) => e.type)).toEqual([
      'crm.loan.created',
      'crm.loan.sanctioned',
    ]);

    const disbursed = (await run(caller, disburseCustomerLoan, {
      entityId: E,
      loanId: loan.id,
    })) as CustomerLoanDto;
    expect(disbursed).toMatchObject({ state: 'disbursed', sanctionedAmount: '240000.00' });
    expect(disbursed.disbursedAt).not.toBeNull();
    expect(await asPrincipal(gm, (ctx) => orderLoanGate(ctx, orderId))).toMatchObject({
      dispatch: 'met',
    });
    const events = await eventsOf(loan.id);
    expect(events.slice(2)).toEqual([
      {
        type: 'crm.loan.disbursed',
        payload: { accountId: ACCOUNT, salesOrderId: orderId, state: 'disbursed', v: 1 },
      },
      {
        type: 'crm.loan.gates_released',
        payload: {
          salesOrderId: orderId,
          state: 'disbursed',
          dispatch: true,
          milestones: [],
          v: 1,
        },
      },
    ]);
    // A disbursed loan is done: it is never rejected afterwards.
    await expect(
      run(gm, rejectCustomerLoan, { entityId: E, loanId: loan.id, reason: 'Late papers' }),
    ).rejects.toMatchObject(reason('customer_loan_transition_not_allowed'));
  });

  it('a sanction releases what waits for it, and the milestones it names', async () => {
    const orderId = await newOrder();
    const loan = await create(gm, orderId, {
      gates: {
        dispatch: 'sanctioned',
        milestones: { advance: 'sanctioned', balance: 'disbursed' },
      },
    });
    await run(gm, sanctionCustomerLoan, {
      entityId: E,
      loanId: loan.id,
      sanctionedAmount: '250000.00',
    });
    const released = (await eventsOf(loan.id)).find((e) => e.type === 'crm.loan.gates_released');
    expect(released?.payload).toEqual({
      salesOrderId: orderId,
      state: 'sanctioned',
      dispatch: true,
      milestones: ['advance'],
      v: 1,
    });
  });

  it('a rejection says why, frees the order for another loan, and tells who to offer another route', async () => {
    const orderId = await newOrder();
    const loan = await create(gm, orderId);
    await expect(
      run(gm, rejectCustomerLoan, { entityId: E, loanId: loan.id, reason: ' ' }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const rejected = (await run(caller, rejectCustomerLoan, {
      entityId: E,
      loanId: loan.id,
      reason: 'Income papers not accepted',
    })) as CustomerLoanDto;
    expect(rejected).toMatchObject({
      state: 'rejected',
      rejectedReason: 'Income papers not accepted',
    });
    expect((await eventsOf(loan.id)).at(-1)).toEqual({
      type: 'crm.loan.rejected',
      payload: {
        accountId: ACCOUNT,
        salesOrderId: orderId,
        opportunityId: null,
        fromState: 'applied',
        state: 'rejected',
        rejectedBy: caller.id,
        v: 1,
      },
    });
    expect(await asPrincipal(gm, (ctx) => orderLoanGate(ctx, orderId))).toMatchObject({
      loanId: null,
      dispatch: 'none',
    });
    await expect(create(gm, orderId)).resolves.toMatchObject({ state: 'applied' });
  });

  it.each([
    ['crm.loan.sanction', sanctionCustomerLoan, { sanctionedAmount: '1000.00' }],
    ['crm.loan.disburse', disburseCustomerLoan, {}],
    ['crm.loan.reject', rejectCustomerLoan, { reason: 'Refused' }],
  ] as const)(
    '%s is refused to Accounts (forbidden), to a company outside the request, and to another caller',
    async (_name, command, extra) => {
      const orderId = await newOrder();
      const loan = await create(gm, orderId);
      const input = { entityId: E, loanId: loan.id, ...extra };
      await expect(run(accounts, command, input)).rejects.toMatchObject({ code: 'forbidden' });
      await expect(run(gm1, command, input)).rejects.toMatchObject({ code: 'forbidden' });
      await expect(run(otherCaller, command, input)).rejects.toMatchObject(reason('loan_missing'));
    },
  );
});

describe('crm.lender.create and crm.lender.update', () => {
  it('the Executive keeps the list; a General Manager may not', async () => {
    await expect(
      run(gm, createLender, { entityId: E, name: 'Loan suite refused bank' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const made = (await run(exec, createLender, {
      entityId: E,
      name: `Loan suite bank ${newId().slice(-6)}`,
    })) as LenderDto;
    expect(made).toMatchObject({ entityId: E, isActive: true });
    await expect(
      run(gm, updateLender, { entityId: E, lenderId: made.id, isActive: false }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const renamed = (await run(exec, updateLender, {
      entityId: E,
      lenderId: made.id,
      name: `${made.name} North`,
      isActive: false,
    })) as LenderDto;
    expect(renamed).toMatchObject({ name: `${made.name} North`, isActive: false });
  });

  it('refuses a name the company already has, whatever its case', async () => {
    await expect(
      run(exec, createLender, { entityId: E, name: lender.name.toUpperCase() }),
    ).rejects.toMatchObject(reason('lender_name_taken'));
  });

  it('refuses a company outside the request', async () => {
    await expect(
      run(exec1, createLender, { entityId: E, name: 'Loan suite other company bank' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      run(exec1, updateLender, { entityId: E, lenderId: lender.id, isActive: false }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('the loan reads', () => {
  it("the order's Loan tab: its loans, the gate and who may record one", async () => {
    const orderId = await newOrder();
    const loan = await create(gm, orderId);
    const read = (who: Principal) =>
      asPrincipal(who, (ctx) => getOrderLoans(ctx, { entityId: E, orderId }));
    const tab = await read(gm);
    expect(tab).toMatchObject({
      orderId,
      accountId: ACCOUNT,
      canWrite: true,
      gate: { loanId: loan.id, dispatch: 'pending' },
    });
    expect(tab.loans.map((l) => l.id)).toEqual([loan.id]);
    expect(tab.lenders.map((l) => l.id)).toContain(lender.id);
    // Accounts reads the loan and its gate, and may not record one.
    expect(await read(accounts)).toMatchObject({ canWrite: false, loans: [{ id: loan.id }] });
    expect(await read(caller)).toMatchObject({ canWrite: true });
    await expect(read(otherCaller)).rejects.toMatchObject(reason('order_missing'));
    await expect(
      asPrincipal(gm1, (ctx) => getOrderLoans(ctx, { entityId: E, orderId })),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it("Account 360's loans, newest first, and a company's lenders", async () => {
    const orderId = await newOrder();
    const loan = await create(gm, orderId);
    const rows = await asPrincipal(gm, (ctx) =>
      listAccountLoans(ctx, { entityId: E, accountId: ACCOUNT }),
    );
    expect(rows[0]).toMatchObject({
      id: loan.id,
      salesOrderId: orderId,
      soNo: `J2T/2098-99/${orderId.slice(-4)}`,
      lenderName: lender.name,
      state: 'applied',
    });
    const lenders = await asPrincipal(accounts, (ctx) => listLenders(ctx, { entityId: E }));
    expect(lenders.map((l) => l.id)).toContain(lender.id);
  });
});
