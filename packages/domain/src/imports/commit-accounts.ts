import {
  AccountImportRowInput,
  DomainError,
  newId,
  type AccountImportSiteInput,
  type ImportCreatedType,
} from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { sql } from 'drizzle-orm';
import type { CommandContext } from '../command/context';
import type { BatchRow } from './commit-leads';

/** What a batch of customer rows made: each row's customer, and the rows refused. */
export interface AccountBatchResult {
  /** A new customer (`account`), or the existing one a row was added to (`account_link`). */
  created: { rowNo: number; id: string; type: ImportCreatedType }[];
  /** Rows whose number belongs to a customer a colleague looks after in one of its companies. */
  refused: number[];
}

/** The refusal `imports.job.commit_batch` counts against a row rather than failing the batch. */
function heldByColleague(): DomainError {
  return new DomainError('conflict', 'a colleague looks after this customer', {
    reason: 'customer_held_by_colleague',
  });
}

/**
 * Commits a batch of customer rows (docs/design/phase1.md §6.3) in a handful of statements. A row
 * whose number a colleague's customer has in one of its companies is refused before anything is
 * written, as a lead with that number is, and the rest go on.
 *
 * A row the preview linked to a customer the importer could see (`existingAccountId`, the owner's
 * rule of 05-10-2026) makes no customer: each of its companies the customer does not deal with yet
 * becomes a relationship owned by the importer (`app.attach_account_entity`, ADR 0008), and the
 * customer's details and sites stay as they are. Whether the link holds is the helper's own
 * answer, never whether this request happens to see the customer: only a customer archived since
 * the check (`missing`) is made anew instead. Any other row becomes its account, one company relationship per company it
 * names (owned by the importer, in their team there), its contact, the contact's link and phone,
 * and its sites (its own and the different ones of its repeated rows), every insert under the
 * policies a person's own writes pass as `app_user`. Any other refusal throws, and the caller's
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
  const open = parsed.filter((r) => !refused.has(r.rowNo));

  // The rows linked to a customer: each of their companies attached through the helper, which
  // sees past this request's view (the worker acts only for the job's companies) and answers
  // whether the customer is still there.
  const wanted = open.flatMap((r) =>
    r.input.existingAccountId === undefined
      ? []
      : [{ rowNo: r.rowNo, accountId: r.input.existingAccountId, entityIds: r.input.entityIds }],
  );
  const missing = new Set<string>();
  if (wanted.length > 0) {
    await keep(tx);
    const attached = (await tx.execute(sql`
      select x."accountId", app.attach_account_entity(x."accountId", x."entityId") as status
        from jsonb_to_recordset(${JSON.stringify(
          wanted.flatMap((l) =>
            l.entityIds.map((entityId) => ({ accountId: l.accountId, entityId })),
          ),
        )}::jsonb) as x("accountId" uuid, "entityId" smallint)`)) as unknown as {
      accountId: string;
      status: string;
    }[];
    for (const x of attached) {
      if (x.status === 'missing') {
        missing.add(x.accountId);
      } else if (x.status !== 'attached' && x.status !== 'already_yours') {
        // Held by a colleague in one of the companies since the number was checked: the row is
        // refused, which the row-by-row path records against it alone.
        throw heldByColleague();
      }
    }
  }
  // A customer archived since the check is made anew from the row.
  const links = wanted.filter((l) => !missing.has(l.accountId));
  const linked = new Set(links.map((l) => l.rowNo));

  const teamIn = (entityId: number): string | null =>
    ctx.principal.entityTeams?.find((t) => t.entityId === entityId)?.teamId ??
    (ctx.entityIds.length === 1 ? (ctx.principal.teamId ?? null) : null);

  const planned = open
    .filter((r) => !linked.has(r.rowNo))
    .map((r) => ({
      ...r,
      accountId: newId(),
      contactId: newId(),
      accountName: r.input.account.name ?? r.input.contact.name,
    }));
  const created: AccountBatchResult['created'] = [
    ...links.map((l) => ({ rowNo: l.rowNo, id: l.accountId, type: 'account_link' as const })),
    ...planned.map((r) => ({ rowNo: r.rowNo, id: r.accountId, type: 'account' as const })),
  ].sort((x, y) => x.rowNo - y.rowNo);
  if (planned.length === 0) return { created, refused: [...refused] };

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
    [...(r.input.site === undefined ? [] : [r.input.site]), ...(r.input.moreSites ?? [])].map(
      (site: AccountImportSiteInput) => ({
        id: newId(),
        accountId: r.accountId,
        type: site.type,
        village: site.village,
        pin: site.pin ?? null,
        createdBy: actor,
      }),
    ),
  );
  if (sites.length > 0) {
    await keep(tx);
    await tx.insert(schema.customerSites).values(sites);
  }
  return { created, refused: [...refused] };
}
