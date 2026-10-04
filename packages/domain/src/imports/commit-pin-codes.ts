import { newId, PinCodeImportRowInput } from '@shakti/contracts';
import type { RequestTx } from '@shakti/db';
import { sql } from 'drizzle-orm';
import type { CommandContext } from '../command/context';
import type { BatchRow } from './commit-leads';

/**
 * Writes a batch of offices into the PIN code master in one statement: a new office is added, and
 * an office the master already has (the same PIN and name) takes the taluk, district and state the
 * directory now gives. Answers the rows that added an office, with its id, so a rollback removes
 * only what this job added; a row that corrected an office records nothing. The policies allow it
 * only to an Executive in a request for every company. `keep` keeps the statement to the deadline.
 */
export async function commitPinCodeBatch(
  ctx: CommandContext,
  tx: RequestTx,
  rows: readonly BatchRow[],
  keep: (tx: RequestTx) => Promise<void> = () => Promise.resolve(),
): Promise<{ created: { rowNo: number; id: string }[] }> {
  if (rows.length === 0) return { created: [] };
  const offices = rows.map((row) => {
    const input = PinCodeImportRowInput.parse(row.input);
    return {
      rowNo: row.rowNo,
      id: newId(),
      pin: input.pin,
      officeName: input.officeName,
      taluk: input.taluk ?? null,
      district: input.district,
      stateCode: input.stateCode ?? null,
    };
  });
  await keep(tx);
  const written = (await tx.execute(sql`
    insert into pin_codes as p (id, pin, office_name, taluk, district, state_code, created_by)
    select x.id, x.pin, x."officeName", x.taluk, x.district, x."stateCode", ${ctx.principal.id}
      from jsonb_to_recordset(${JSON.stringify(offices)}::jsonb)
        as x(id uuid, pin text, "officeName" text, taluk text, district text, "stateCode" text)
    on conflict on constraint pin_codes_pin_office_unique do update
       set taluk = excluded.taluk, district = excluded.district, state_code = excluded.state_code,
           updated_by = ${ctx.principal.id}
    returning p.id, p.pin, p.office_name as "officeName", (xmax = 0) as inserted`)) as unknown as {
    id: string;
    pin: string;
    officeName: string;
    inserted: boolean;
  }[];
  const added = new Set(written.filter((w) => w.inserted).map((w) => w.id));
  return {
    created: offices.filter((o) => added.has(o.id)).map((o) => ({ rowNo: o.rowNo, id: o.id })),
  };
}
