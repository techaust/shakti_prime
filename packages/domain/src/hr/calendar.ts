import { schema, type RequestTx } from '@shakti/db';
import { sql } from 'drizzle-orm';

/**
 * The holidays of a company and of the whole group between two calendar dates, both included, as
 * the request reads them. `holidays` is where the business calendar's days off are kept
 * (DATABASE §6.1 `business_calendar`, §6.8): a leave request counts its days against them, and
 * the scheduling board's leave check reads them from here.
 */
export async function holidaysBetween(
  tx: RequestTx,
  entityId: number,
  fromDate: string,
  toDate: string,
): Promise<Set<string>> {
  const h = schema.holidays;
  const rows = await tx
    .select({ onDate: h.onDate })
    .from(h)
    .where(
      sql`${h.onDate} between ${fromDate} and ${toDate}
          and (${h.entityId} is null or ${h.entityId} = ${entityId})`,
    );
  return new Set(rows.map((r) => r.onDate));
}
