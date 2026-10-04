import { newId, PinCodeImportRowInput } from '@shakti/contracts';
import type { RequestTx } from '@shakti/db';
import { sql } from 'drizzle-orm';
import type { CommandContext } from '../command/context';
import type { BatchRow } from './commit-leads';

/**
 * Sites of every company whose PIN is one of these are checked again against the master
 * (`app.recheck_site_pins`): a PIN it now knows clears the site's flag and fills its empty tehsil,
 * district and state; a PIN it no longer knows flags the site again. Answers how many changed.
 */
export async function recheckSitePins(tx: RequestTx, pins: readonly string[]): Promise<number> {
  if (pins.length === 0) return 0;
  const [row] = (await tx.execute(sql`
    select app.recheck_site_pins(
      array(select jsonb_array_elements_text(${JSON.stringify([...new Set(pins)])}::jsonb))
    ) as n`)) as unknown as { n: number }[];
  return row?.n ?? 0;
}

/**
 * Writes a batch of offices into the PIN code master in one statement: a new office is added, and
 * an office the master already has (the same PIN, and the same name in any case) takes the taluk,
 * district and state the directory now gives. Answers the rows that added an office, with its id,
 * so a rollback removes only what this job added; a row that corrected an office records nothing.
 * The sites waiting for one of the batch's PINs are then checked again (`recheckSitePins`). The
 * policies allow it only to an Executive in a request for every company. `keep` keeps each
 * statement to the deadline.
 */
export async function commitPinCodeBatch(
  ctx: CommandContext,
  tx: RequestTx,
  rows: readonly BatchRow[],
  keep: (tx: RequestTx) => Promise<void> = () => Promise.resolve(),
): Promise<{ created: { rowNo: number; id: string }[]; sitesChecked: number }> {
  if (rows.length === 0) return { created: [], sitesChecked: 0 };
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
    on conflict (pin, lower(office_name)) do update
       set taluk = excluded.taluk, district = excluded.district, state_code = excluded.state_code,
           updated_by = ${ctx.principal.id}
    returning p.id, p.pin, p.office_name as "officeName", (xmax = 0) as inserted`)) as unknown as {
    id: string;
    pin: string;
    officeName: string;
    inserted: boolean;
  }[];
  const added = new Set(written.filter((w) => w.inserted).map((w) => w.id));
  await keep(tx);
  const sitesChecked = await recheckSitePins(
    tx,
    offices.map((o) => o.pin),
  );
  return {
    created: offices.filter((o) => added.has(o.id)).map((o) => ({ rowNo: o.rowNo, id: o.id })),
    sitesChecked,
  };
}
