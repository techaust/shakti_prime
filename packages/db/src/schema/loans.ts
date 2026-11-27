import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { actorsRequired, timestamps } from './columns';
import { entities } from './entities';
import { principals } from './principals';
import { salesOrders } from './sales-orders';

const money = (name: string) => numeric(name, { precision: 14, scale: 2 });

/** The states a loan holds its order's gates in: one such loan per order. */
const ACTIVE = sql.raw(`('applied', 'sanctioned', 'disbursed')`);

/**
 * The banks and schemes a company's customers borrow from (docs/03-roadmap-appendix/phase4.md
 * §6.2, J2): a list per company that an Executive keeps in Settings › Lenders
 * (`admin.entities.write`), read by every principal acting in the company. It starts empty until
 * the client names its lenders (phase4 §12 question 6); a lender is switched off, never removed,
 * since loans name it.
 */
export const lenders = pgTable(
  'lenders',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    check('lenders_name_check', sql`length(btrim(${t.name})) between 2 and 120`),
    // The key a loan names its lender by, so the lender stays in the loan's company.
    unique('lenders_id_entity_unique').on(t.id, t.entityId),
    // One lender of a name per company, whatever its case.
    uniqueIndex('lenders_entity_name_unique').on(t.entityId, sql`lower(btrim(${t.name}))`),
  ],
);

/**
 * A customer's loan for one order (docs/03-roadmap-appendix/phase4.md §6.2, PRD CRM-08), driven by
 * the `customer-loan` machine through `crm.loan.create`, `.sanction`, `.disburse` and `.reject`.
 * Its company and customer are its order's (the composite key), and it follows the order when a
 * customer merge moves it (ON UPDATE CASCADE). `gates_json` says until which state the loan holds
 * back the order's dispatch (a Phase 5 payment milestone keeps its own loan gate);
 * `app.order_loan_gate()` is the one answer to whether the gate is met. While a loan is applied,
 * sanctioned or disbursed it is the order's one active loan; a rejected loan leaves room for
 * another, and keeps holding the order back until another loan replaces it or a person records,
 * with a reason, that the order no longer waits on a loan (`gates_waived_*`,
 * `crm.loan.gates.waive`).
 */
export const customerLoans = pgTable(
  'customer_loans',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    salesOrderId: uuid('sales_order_id').notNull(),
    /** A lender of the company's list, or, while the list is empty, a name typed once. */
    lenderId: uuid('lender_id'),
    lenderName: text('lender_name'),
    /** The amount applied for. */
    amount: money('amount').notNull(),
    state: text('state').notNull().default('applied'),
    stateChangedAt: timestamp('state_changed_at', { withTimezone: true }).notNull().defaultNow(),
    sanctionedAmount: money('sanctioned_amount'),
    sanctionedAt: timestamp('sanctioned_at', { withTimezone: true }),
    disbursedAt: timestamp('disbursed_at', { withTimezone: true }),
    /** The lender's own reference for the application or the loan account. */
    reference: text('reference'),
    rejectedReason: text('rejected_reason'),
    /** `{ dispatch }` as the contract `LoanGatesSchema` validates it. */
    gatesJson: jsonb('gates_json').notNull().default({ dispatch: 'disbursed' }),
    /** A turned-down loan's gates waived: when, by whom and why; set once, never changed. */
    gatesWaivedAt: timestamp('gates_waived_at', { withTimezone: true }),
    gatesWaivedBy: uuid('gates_waived_by').references(() => principals.id),
    gatesWaivedReason: text('gates_waived_reason'),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    foreignKey({
      name: 'customer_loans_order_fk',
      columns: [t.salesOrderId, t.entityId, t.accountId],
      foreignColumns: [salesOrders.id, salesOrders.entityId, salesOrders.accountId],
    }).onUpdate('cascade'),
    foreignKey({
      name: 'customer_loans_lender_fk',
      columns: [t.lenderId, t.entityId],
      foreignColumns: [lenders.id, lenders.entityId],
    }),
    // One active loan per order: a second is refused while one is applied, sanctioned or
    // disbursed, also when two are recorded at once.
    uniqueIndex('customer_loans_active_unique')
      .on(t.salesOrderId)
      .where(sql`${t.state} in ${ACTIVE}`),
    check(
      'customer_loans_state_check',
      sql`${t.state} in ('applied', 'sanctioned', 'disbursed', 'rejected')`,
    ),
    // A loan names a lender of the list or a typed name, never both.
    check(
      'customer_loans_lender_check',
      sql`(${t.lenderId} is null) <> (${t.lenderName} is null)
       and (${t.lenderName} is null or length(btrim(${t.lenderName})) between 2 and 120)`,
    ),
    check(
      'customer_loans_amounts_check',
      sql`${t.amount} > 0 and (${t.sanctionedAmount} is null or ${t.sanctionedAmount} > 0)`,
    ),
    // A sanctioned loan keeps its amount and when; a disbursed one was sanctioned first; only a
    // rejected loan says why, and an applied one has neither.
    check(
      'customer_loans_sanction_check',
      sql`(${t.sanctionedAmount} is null) = (${t.sanctionedAt} is null)
       and (${t.state} not in ('sanctioned', 'disbursed') or ${t.sanctionedAt} is not null)
       and (${t.state} <> 'applied' or ${t.sanctionedAt} is null)`,
    ),
    check(
      'customer_loans_disbursed_check',
      sql`(${t.state} = 'disbursed') = (${t.disbursedAt} is not null)`,
    ),
    check(
      'customer_loans_rejected_check',
      sql`(${t.state} = 'rejected') = (${t.rejectedReason} is not null)
       and (${t.rejectedReason} is null or length(btrim(${t.rejectedReason})) between 1 and 300)`,
    ),
    check(
      'customer_loans_reference_check',
      sql`${t.reference} is null or length(btrim(${t.reference})) between 1 and 60`,
    ),
    // The gates hold the dispatch and nothing else, and a missing dispatch fails the check rather
    // than passing it (`->>` gives null for a missing key).
    check(
      'customer_loans_gates_check',
      sql`jsonb_typeof(${t.gatesJson}) = 'object' and ${t.gatesJson} - 'dispatch' = '{}'::jsonb`,
    ),
    check(
      'customer_loans_gates_dispatch_check',
      sql`coalesce(${t.gatesJson} ->> 'dispatch', '') in ('disbursed', 'sanctioned', 'none')`,
    ),
    // A waiver is recorded whole, with its reason, and only on a rejected loan.
    check(
      'customer_loans_waiver_check',
      sql`(${t.gatesWaivedAt} is null) = (${t.gatesWaivedBy} is null)
       and (${t.gatesWaivedAt} is null) = (${t.gatesWaivedReason} is null)
       and (${t.gatesWaivedAt} is null or ${t.state} = 'rejected')
       and (${t.gatesWaivedReason} is null or length(btrim(${t.gatesWaivedReason})) between 1 and 300)`,
    ),
    // An order's loans, newest first (the Loan tab) and the gate answer's lookup.
    index('customer_loans_order_idx').on(t.salesOrderId, t.createdAt),
    // Account 360's loans, newest first.
    index('customer_loans_account_idx').on(t.accountId, t.entityId, t.createdAt),
    index('customer_loans_lender_idx').on(t.lenderId),
    index('customer_loans_entity_created_idx').on(t.entityId, t.createdAt),
  ],
);
