import { AccountImportRowInput, newId } from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { sql } from 'drizzle-orm';
import type { CommandContext } from '../command/context';
import type { BatchRow } from './commit-leads';

/** What a batch of customer rows made: each row's customer, and the rows refused. */
export interface AccountBatchResult {
  created: { rowNo: number; id: string }[];
  /** Rows whose number belongs to a customer a colleague looks after in one of its companies. */
  refused: number[];
}

/**
 * Commits a batch of customer rows (docs/design/phase1.md §6.3) in a handful of statements: each
 * row its account, one company relationship per company it names (owned by the importer, in their
 * team there), its contact, the contact's link and phone, and its site when it gives a village,
 * every insert under the policies a person's own writes pass as `app_user`. A row whose number a
 * colleague's customer has in one of its companies is refused before anything is written, as a
 * lead with that number is (0055), and the rest go on. Any other refusal throws, and the caller's
 * savepoint takes the batch back. `keep` keeps each statement to the batch's deadline.
 */
export async function commitAccountBatch(
  ctx: CommandContext,
  tx: RequestTx,
  rows: readonly BatchRow[],
  keep: (tx: RequestTx) => Promise<void> = () => Promise.resolve(),
): Promise<AccountBatchResult> {
  const actor = ctx.principal.id;
  const parsed = rows.map((row) => ({
    rowNo: row.rowNo,
    input: AccountImportRowInput.parse(row.input),
  }));
  if (parsed.length === 0) return { created: [], refused: [] };

  await keep(tx);
  const held = (await tx.execute(sql`
    select distinct x."rowNo"
      from jsonb_to_recordset(${JSON.stringify(
        parsed.flatMap((r) =>
          r.input.entityIds.map((entityId) => ({
            rowNo: r.rowNo,
            phone: r.input.contact.phone,
            entityId,
          })),
        ),
      )}::jsonb) as x("rowNo" int, phone text, "entityId" smallint)
     where app.lead_phone_status(x.phone, x."entityId") = 'held_by_other'`)) as unknown as {
    rowNo: number;
  }[];
  const refused = new Set(held.map((h) => h.rowNo));

  const teamIn = (entityId: number): string | null =>
    ctx.principal.entityTeams?.find((t) => t.entityId === entityId)?.teamId ??
    (ctx.entityIds.length === 1 ? (ctx.principal.teamId ?? null) : null);

  const planned = parsed
    .filter((r) => !refused.has(r.rowNo))
    .map((r) => ({
      ...r,
      accountId: newId(),
      contactId: newId(),
      accountName: r.input.account.name ?? r.input.contact.name,
    }));
  if (planned.length === 0) return { created: [], refused: [...refused] };

  // The same writes as a lead's customer, in the same order, so each policy sees what it checks.
  // No `returning` on the roots: a new customer is not visible until it has a relationship.
  await keep(tx);
  await tx.insert(schema.accounts).values(
    planned.map((r) => ({
      id: r.accountId,
      type: r.input.account.type,
      name: r.accountName,
      createdBy: actor,
    })),
  );
  await keep(tx);
  await tx.insert(schema.accountEntities).values(
    planned.flatMap((r) =>
      r.input.entityIds.map((entityId) => ({
        id: newId(),
        accountId: r.accountId,
        entityId,
        ownerId: actor,
        teamId: teamIn(entityId),
        createdBy: actor,
      })),
    ),
  );
  await keep(tx);
  await tx.insert(schema.contacts).values(
    planned.map((r) => ({
      id: r.contactId,
      name: r.input.contact.name,
      preferredLanguage: r.input.contact.preferredLanguage,
      createdBy: actor,
    })),
  );
  await keep(tx);
  await tx.insert(schema.accountContacts).values(
    planned.map((r) => ({
      accountId: r.accountId,
      contactId: r.contactId,
      role: 'owner' as const,
      createdBy: actor,
    })),
  );
  await keep(tx);
  await tx.insert(schema.contactPhones).values(
    planned.map((r) => ({
      id: newId(),
      contactId: r.contactId,
      e164: r.input.contact.phone,
      isPrimary: true,
      isWhatsapp: true,
      createdBy: actor,
    })),
  );
  const sites = planned.flatMap((r) =>
    r.input.site === undefined
      ? []
      : [
          {
            id: newId(),
            accountId: r.accountId,
            type: r.input.site.type,
            village: r.input.site.village,
            pin: r.input.site.pin ?? null,
            createdBy: actor,
          },
        ],
  );
  if (sites.length > 0) {
    await keep(tx);
    await tx.insert(schema.customerSites).values(sites);
  }
  return {
    created: planned.map((r) => ({ rowNo: r.rowNo, id: r.accountId })),
    refused: [...refused],
  };
}
