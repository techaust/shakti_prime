import { CreateLeadInput, newId, type LeadDto } from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { CommandContext } from '../command/context';
import { createLead, lockNewNumbers } from '../commands/crm/create-lead';
import { inputHash } from '../idempotency/hash';
import { toLeadDto } from '../queries/crm/lead-dto';
import { importRowKey } from './row-key';

/** One valid row of a batch, in file order, with the `crm.lead.create` input the preview stored. */
export interface BatchRow {
  rowNo: number;
  input: unknown;
}

/**
 * The set-based path found something it does not handle (a row that fails, a key already used,
 * a customer the group already knows, a number a colleague's customer has, a consent): the batch
 * is run again row by row.
 */
export class RowByRowNeeded extends Error {
  /** What sent the batch row by row: a fixed phrase, never a value from the file. */
  readonly why: string;

  constructor(why: string) {
    super(`import batch goes row by row: ${why}`);
    this.name = 'RowByRowNeeded';
    this.why = why;
  }
}

/**
 * Commits a batch of lead rows as `crm.lead.create` would, one row at a time, with the same
 * guard, input, idempotency key and event, but in a handful of statements for the whole batch
 * (docs/spikes/import-scale.md): each row still gets its own account, contact, phone, company
 * relationship, site and opportunity, every insert passes the same policies as `app_user`, and
 * each row claims its key `import:{job}:{row}` with the input hash and the lead answer the command
 * would store. The events are the command's, one `crm.lead.created` a row; the caller writes the
 * batch's one audit row.
 *
 * Anything outside the plain new-customer row throws `RowByRowNeeded` before a row is written,
 * and a database refusal part-way throws as it is; either way the caller's savepoint takes the
 * batch back and the batch runs again through `ctx.run(createLead)`, which finds the row at fault.
 */
export async function commitLeadBatch(
  ctx: CommandContext,
  tx: RequestTx,
  jobId: string,
  rows: readonly BatchRow[],
): Promise<{ rowNo: number; id: string }[]> {
  const actor = ctx.principal.id;
  const teamId = ctx.principal.teamId ?? null;

  const parsed = rows.map((row) => {
    const result = CreateLeadInput.safeParse(row.input);
    if (!result.success) throw new RowByRowNeeded('a row does not parse');
    const input = result.data;
    if (!ctx.entityIds.includes(input.entityId)) throw new RowByRowNeeded('another company');
    if (input.existingAccountId !== undefined) throw new RowByRowNeeded('a known customer');
    if (input.consent !== undefined) throw new RowByRowNeeded('a consent');
    if (input.contact === undefined || input.account === undefined) {
      throw new RowByRowNeeded('no contact or account');
    }
    return {
      rowNo: row.rowNo,
      input,
      contact: input.contact,
      account: input.account,
      key: importRowKey(jobId, row.rowNo),
      hash: inputHash(createLead.name, input),
    };
  });
  if (parsed.length === 0) return [];

  // A number that belongs to a colleague's customer in the company is refused by the command
  // (`app.lead_phone_status()`, 0055), and the row-by-row path marks that row and goes on. Asked
  // before any row is written, as the command asks it: a row of this batch that shares a number
  // with an earlier one finds the caller's own new customer, which never counts against them.
  // Every number is held first, as the command holds it, so a lead typed in at the same moment
  // with one of them waits for this batch, or this batch for it, and the second finds the first.
  await lockNewNumbers(
    tx,
    parsed.map((r) => ({ phone: r.contact.phone, entityId: r.input.entityId })),
  );
  const held = (await tx.execute(sql`
    select 1 as held
      from jsonb_to_recordset(${JSON.stringify(
        parsed.map((r) => ({ phone: r.contact.phone, entityId: r.input.entityId })),
      )}::jsonb) as x(phone text, "entityId" smallint)
     where app.lead_phone_status(x.phone, x."entityId") = 'held_by_other'
     limit 1`)) as unknown as { held: number }[];
  if (held.length > 0) throw new RowByRowNeeded('a customer a colleague looks after');

  // The pipelines, first open stages and sources the rows name, looked up once for the batch.
  const entityIds = [...new Set(parsed.map((r) => r.input.entityId))];
  const pipelineKeys = [...new Set(parsed.map((r) => r.input.pipelineKey))];
  const p = schema.pipelines;
  const pipelines = await tx
    .select({ id: p.id, key: p.key, entityId: p.entityId })
    .from(p)
    .where(
      and(
        inArray(p.key, pipelineKeys),
        eq(p.isActive, true),
        or(isNull(p.entityId), inArray(p.entityId, entityIds)),
      ),
    );
  const pipelineFor = (key: string, entityId: number): string => {
    const found = pipelines.filter(
      (row) => row.key === key && (row.entityId === null || row.entityId === entityId),
    );
    // More than one would leave the choice to the row-by-row path, as the command makes it.
    if (found.length !== 1 || found[0] === undefined) throw new RowByRowNeeded('pipeline');
    return found[0].id;
  };
  const ps = schema.pipelineStages;
  const stages =
    pipelines.length === 0
      ? []
      : await tx
          .select({ id: ps.id, pipelineId: ps.pipelineId })
          .from(ps)
          .where(
            and(
              inArray(
                ps.pipelineId,
                pipelines.map((row) => row.id),
              ),
              eq(ps.kind, 'open'),
            ),
          )
          .orderBy(asc(ps.position));
  const stageFor = (pipelineId: string): string => {
    const stage = stages.find((row) => row.pipelineId === pipelineId);
    if (stage === undefined) throw new RowByRowNeeded('stage');
    return stage.id;
  };
  const sourceCodes = [
    ...new Set(
      parsed.flatMap((r) => (r.input.sourceCode === undefined ? [] : [r.input.sourceCode])),
    ),
  ];
  const ls = schema.leadSources;
  const sources =
    sourceCodes.length === 0
      ? []
      : await tx
          .select({ id: ls.id, code: ls.code })
          .from(ls)
          .where(and(inArray(ls.code, sourceCodes), eq(ls.isActive, true)));
  const sourceFor = (code: string | undefined): string | null => {
    if (code === undefined) return null;
    const found = sources.filter((row) => row.code === code);
    if (found.length !== 1 || found[0] === undefined) throw new RowByRowNeeded('source');
    return found[0].id;
  };

  const planned = parsed.map((row) => {
    const pipelineId = pipelineFor(row.input.pipelineKey, row.input.entityId);
    return {
      ...row,
      pipelineId,
      stageId: stageFor(pipelineId),
      sourceId: sourceFor(row.input.sourceCode),
      accountId: newId(),
      accountName: row.account.name ?? row.contact.name,
      contactId: newId(),
      siteId: row.input.site === undefined ? null : newId(),
      opportunityId: newId(),
    };
  });

  // Every key must be new; a key used before is a repeat the row-by-row path answers.
  const k = schema.idempotencyKeys;
  const claimed = await tx
    .insert(k)
    .values(
      planned.map((row) => ({
        principalId: actor,
        key: row.key,
        command: createLead.name,
        inputHash: row.hash,
      })),
    )
    .onConflictDoNothing()
    .returning({ key: k.key });
  if (claimed.length !== planned.length) throw new RowByRowNeeded('a key was used before');

  // The same writes as the command, in the same order, so each policy sees what it checks.
  await tx.insert(schema.accounts).values(
    planned.map((row) => ({
      id: row.accountId,
      type: row.account.type,
      name: row.accountName,
      createdBy: actor,
    })),
  );
  await tx.insert(schema.accountEntities).values(
    planned.map((row) => ({
      id: newId(),
      accountId: row.accountId,
      entityId: row.input.entityId,
      ownerId: actor,
      teamId,
      createdBy: actor,
    })),
  );
  await tx.insert(schema.contacts).values(
    planned.map((row) => ({
      id: row.contactId,
      name: row.contact.name,
      preferredLanguage: row.contact.preferredLanguage,
      createdBy: actor,
    })),
  );
  await tx.insert(schema.accountContacts).values(
    planned.map((row) => ({
      accountId: row.accountId,
      contactId: row.contactId,
      role: 'owner' as const,
      createdBy: actor,
    })),
  );
  await tx.insert(schema.contactPhones).values(
    planned.map((row) => ({
      id: newId(),
      contactId: row.contactId,
      e164: row.contact.phone,
      isPrimary: true,
      isWhatsapp: true,
      createdBy: actor,
    })),
  );
  const withSite = planned.flatMap((row) =>
    row.siteId === null || row.input.site === undefined
      ? []
      : [
          {
            id: row.siteId,
            accountId: row.accountId,
            type: row.input.site.type,
            village: row.input.site.village,
            pin: row.input.site.pin ?? null,
            createdBy: actor,
          },
        ],
  );
  if (withSite.length > 0) await tx.insert(schema.customerSites).values(withSite);
  const opportunities = await tx
    .insert(schema.opportunities)
    .values(
      planned.map((row) => ({
        id: row.opportunityId,
        entityId: row.input.entityId,
        accountId: row.accountId,
        siteId: row.siteId,
        pipelineId: row.pipelineId,
        stageId: row.stageId,
        ownerId: actor,
        teamId,
        sourceId: row.sourceId,
        createdBy: actor,
      })),
    )
    .returning();
  const byId = new Map(opportunities.map((o) => [o.id, o]));

  const answers: { key: string; response: LeadDto }[] = [];
  for (const row of planned) {
    const opportunity = byId.get(row.opportunityId);
    if (opportunity === undefined) throw new RowByRowNeeded('an opportunity was not returned');
    answers.push({
      key: row.key,
      response: toLeadDto(
        opportunity,
        { id: row.accountId, type: row.account.type, name: row.accountName },
        { id: row.contactId, name: row.contact.name },
        row.contact.phone,
      ),
    });
    ctx.emit({
      type: 'crm.lead.created',
      entityId: row.input.entityId,
      aggregateType: 'opportunity',
      aggregateId: row.opportunityId,
      payload: {
        pipelineKey: row.input.pipelineKey,
        sourceCode: row.input.sourceCode ?? null,
        existingAccount: false,
      },
    });
  }

  // Each key keeps the answer a repeat of that row replays, as the command's key would.
  await tx.execute(sql`
    update idempotency_keys k
       set response_json = x.response
      from jsonb_to_recordset(${JSON.stringify(answers)}::jsonb) as x(key text, response jsonb)
     where k.principal_id = ${actor} and k.key = x.key`);

  return planned.map((row) => ({ rowNo: row.rowNo, id: row.opportunityId }));
}
