// FN1's journeys (`e2e/finance.spec.ts`), written by the seed on the host. Per project, two
// dealers of company 1 whose relationship the journeys' Lead Converter holds, each with
// generous credit terms and one order she confirmed here, so the platform planned its payments
// from the standard terms as it does on any confirmation (the events the seed leaves are delivered
// before the journeys start). Accounts issues a proforma of the first; the Lead Converter reads the
// second. The order's lines are the journeys' items at the journeys' prices, written as an order
// holds them; every figure is a test value for the journeys alone, never a client figure.
import { newId } from '@shakti/contracts';
import { asMigrator, principalFor } from '@shakti/db/testing';
import { confirmSalesOrder, executeCommand, setDealerTerms } from '@shakti/domain';
import {
  FINANCE_DEALERS,
  PROJECTS,
  type FinanceJourneySeed,
  type ProjectName,
} from '../support/users';
import { QUOTE_JOURNEY_IDS } from './quotes';

const COMPANY = 1;

/** An order number of the journeys' own, outside the company's series. */
const ORDER_NO: Record<ProjectName, { accounts: string; converter: string }> = {
  'desktop-light': { accounts: 'SS/SO/2026-27/9101', converter: 'SS/SO/2026-27/9102' },
  'desktop-dark': { accounts: 'SS/SO/2026-27/9103', converter: 'SS/SO/2026-27/9104' },
  phone: { accounts: 'SS/SO/2026-27/9105', converter: 'SS/SO/2026-27/9106' },
};

/** A dealer of company 1 held by the converter, with terms that never hold its orders. */
async function ensureDealer(
  executiveId: string,
  converterId: string,
  name: string,
): Promise<string> {
  const [found] = await asMigrator(
    (m) => m<{ id: string }[]>`
      select a.id from accounts a
        join account_entities ae on ae.account_id = a.id and ae.entity_id = ${COMPANY}
       where a.type = 'dealer' and a.name = ${name} and a.archived_at is null
       limit 1`,
  );
  if (found) return found.id;
  const accountId = newId();
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into accounts (id, type, name, tier_id, created_by)
               values (${accountId}, 'dealer', ${name}, ${QUOTE_JOURNEY_IDS.tier}, ${executiveId})`;
      await tx`insert into account_entities (id, account_id, entity_id, owner_id, created_by)
               values (${newId()}, ${accountId}, ${COMPANY}, ${converterId}, ${executiveId})`;
    }),
  );
  await executeCommand(
    principalFor('executive', [1, 2, 3, 4], { id: executiveId }),
    { entityIds: [COMPANY] },
    setDealerTerms,
    { entityId: COMPANY, accountId, creditLimit: '500000.00', creditDays: 30 },
  );
  return accountId;
}

/**
 * The dealer's confirmed order, made once: 2 solar modules at ₹12,000 with 12% GST and 10 metres
 * of cable at ₹85.50 with 18%, within the state (₹27,889 with rounding), written as a draft and
 * confirmed by the converter through `sales.order.confirm`.
 */
async function ensureConfirmedOrder(
  converterId: string,
  accountId: string,
  soNo: string,
): Promise<string> {
  const [found] = await asMigrator(
    (m) => m<{ id: string }[]>`select id from sales_orders
                                where entity_id = ${COMPANY} and so_no = ${soNo}`,
  );
  if (found) return found.id;
  const id = newId();
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into sales_orders (id, entity_id, so_no, fy, account_id, account_type, tier_id,
                 place_of_supply_state, supply_kind, state, subtotal, cgst, sgst, igst, tax_total,
                 round_off, grand_total, created_by)
               values (${id}, ${COMPANY}, ${soNo}, '2026-27', ${accountId}, 'dealer',
                       ${QUOTE_JOURNEY_IDS.tier}, '08', 'intra', 'draft', 24855.00, 1516.95, 1516.95,
                       0, 3033.90, 0.10, 27889.00, ${converterId})`;
      await tx`insert into sales_order_lines (id, entity_id, sales_order_id, position, item_id, sku,
                 description, unit, qty, unit_price, hsn, tax_rate_id, tax_rate_pct, taxable_value,
                 cgst, sgst, igst, line_total)
               values (${newId()}, ${COMPANY}, ${id}, 1, ${QUOTE_JOURNEY_IDS.module}, 'JRN-MOD-540',
                       'Solar module 540 Wp', 'nos', 2, 12000.00, '8541', ${QUOTE_JOURNEY_IDS.moduleRate},
                       12.00, 24000.00, 1440.00, 1440.00, 0, 26880.00),
                      (${newId()}, ${COMPANY}, ${id}, 2, ${QUOTE_JOURNEY_IDS.cable}, 'JRN-CBL-4',
                       'Solar cable 4 sq mm', 'metre', 10, 85.50, '8544', ${QUOTE_JOURNEY_IDS.cableRate},
                       18.00, 855.00, 76.95, 76.95, 0, 1008.90)`;
    }),
  );
  await executeCommand(
    principalFor('tele_caller_lc', [COMPANY], { id: converterId }),
    { entityIds: [COMPANY] },
    confirmSalesOrder,
    { entityId: COMPANY, orderId: id },
  );
  return id;
}

/** Makes the finance journeys' orders and answers what the journeys need of them. */
export async function ensureFinanceJourneys(
  executiveId: string,
  converterId: string,
): Promise<FinanceJourneySeed> {
  const orders = {} as FinanceJourneySeed['orders'];
  for (const project of PROJECTS) {
    const names = FINANCE_DEALERS[project];
    const numbers = ORDER_NO[project];
    const forAccounts = await ensureDealer(executiveId, converterId, names.accounts);
    const forConverter = await ensureDealer(executiveId, converterId, names.converter);
    orders[project] = {
      accounts: {
        orderId: await ensureConfirmedOrder(converterId, forAccounts, numbers.accounts),
        soNo: numbers.accounts,
      },
      converter: {
        orderId: await ensureConfirmedOrder(converterId, forConverter, numbers.converter),
        soNo: numbers.converter,
      },
    };
  }
  return { entityId: COMPANY, orders };
}
