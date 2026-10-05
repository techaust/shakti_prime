import {
  AccountDuplicatesDto,
  CustomerMergeMovedDto,
  DomainError,
  DuplicatePageDto,
  DuplicateRowDto,
  hasGrant,
  ListAccountDuplicatesInput,
  ListDuplicatesInput,
  PreviewCustomerMergeInput,
  type DuplicateSideDto,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { checkPermission, isAgent } from '../../command/run-command';
import { decodeCursor, encodeCursor, parseQueryInput } from '../parse-input';

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;
type CandidateRow = typeof schema.duplicateCandidates.$inferSelect;

/**
 * The duplicate screens (PRD CRM-03, docs/design/phase1.md §7.4): `/duplicates` for a team lead
 * and above, and the cards on Account 360. Everything is read under the caller's own policies: a
 * candidate shows only to someone who sees both of its customers, or both of its leads. A pair
 * whose customer or lead was merged away (archived) is left out. Phones show their last four
 * digits only. For people only: an agent reads no customer's details (SECURITY §3.3).
 */

function checkPerson(ctx: Ctx): void {
  if (isAgent(ctx.principal) || ctx.principal.kind !== 'user') {
    throw new DomainError('forbidden', 'the duplicate screens are for people');
  }
}

const Cursor = z
  .object({ c: z.number().int(), t: z.string().max(40), id: z.string().uuid() })
  .strict();

const PG_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;

/** Neither side of the pair was merged away. */
function bothLive(): SQL {
  const d = schema.duplicateCandidates;
  return sql`not exists (select 1 from ${schema.accounts} a
                          where a.id in (${d.accountId}, ${d.otherAccountId})
                            and a.archived_at is not null)
         and not exists (select 1 from ${schema.opportunities} o
                          where o.id in (${d.opportunityId}, ${d.otherOpportunityId})
                            and o.archived_at is not null)`;
}

/** The two sides of each candidate as its card shows them, read under the caller's policies. */
async function withSides(ctx: Ctx, rows: readonly CandidateRow[]): Promise<DuplicateRowDto[]> {
  if (rows.length === 0) return [];
  const o = schema.opportunities;
  const leadIds = rows.flatMap((r) =>
    r.kind === 'lead' && r.opportunityId !== null && r.otherOpportunityId !== null
      ? [r.opportunityId, r.otherOpportunityId]
      : [],
  );
  const leads =
    leadIds.length === 0
      ? []
      : await ctx.tx
          .select({
            id: o.id,
            accountId: o.accountId,
            state: o.state,
            pipelineName: schema.pipelines.name,
            stageName: schema.pipelineStages.name,
            ownerName: schema.principals.displayName,
          })
          .from(o)
          .innerJoin(schema.pipelines, eq(schema.pipelines.id, o.pipelineId))
          .innerJoin(schema.pipelineStages, eq(schema.pipelineStages.id, o.stageId))
          .leftJoin(schema.principals, eq(schema.principals.id, o.ownerId))
          .where(inArray(o.id, leadIds));
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const accountIds = [
    ...new Set([
      ...rows.flatMap((r) =>
        r.kind === 'customer' && r.accountId !== null && r.otherAccountId !== null
          ? [r.accountId, r.otherAccountId]
          : [],
      ),
      ...leads.map((l) => l.accountId),
    ]),
  ];
  const a = schema.accounts;
  const ac = schema.accountContacts;
  const ph = schema.contactPhones;
  const cs = schema.customerSites;
  const ae = schema.accountEntities;
  const [accounts, phones, villages, relationships] =
    accountIds.length === 0
      ? [[], [], [], []]
      : await Promise.all([
          ctx.tx
            .select({ id: a.id, name: a.name, type: a.type })
            .from(a)
            .where(inArray(a.id, accountIds)),
          ctx.tx
            .select({ accountId: ac.accountId, e164: ph.e164 })
            .from(ac)
            .innerJoin(ph, and(eq(ph.contactId, ac.contactId), eq(ph.isPrimary, true)))
            .where(and(inArray(ac.accountId, accountIds), eq(ac.role, 'owner'))),
          ctx.tx
            .selectDistinctOn([cs.accountId], { accountId: cs.accountId, village: cs.village })
            .from(cs)
            .where(
              and(inArray(cs.accountId, accountIds), isNull(cs.archivedAt), isNotNull(cs.village)),
            )
            .orderBy(cs.accountId, asc(cs.createdAt)),
          ctx.tx
            .select({ accountId: ae.accountId, entityId: ae.entityId })
            .from(ae)
            .where(inArray(ae.accountId, accountIds))
            .orderBy(asc(ae.entityId)),
        ]);
  const accountById = new Map(accounts.map((x) => [x.id, x]));
  const phoneOf = new Map(phones.map((x) => [x.accountId, x.e164]));
  const villageOf = new Map(villages.map((x) => [x.accountId, x.village]));

  const side = (accountId: string, leadId: string | null): DuplicateSideDto | undefined => {
    const account = accountById.get(accountId);
    if (account === undefined) return undefined;
    const lead = leadId === null ? undefined : leadById.get(leadId);
    const phone = phoneOf.get(accountId);
    return {
      accountId,
      accountName: account.name,
      accountType: account.type as DuplicateSideDto['accountType'],
      phoneLast4: phone === undefined ? null : phone.slice(-4),
      village: villageOf.get(accountId) ?? null,
      entityIds: relationships.filter((r) => r.accountId === accountId).map((r) => r.entityId),
      opportunityId: lead?.id ?? null,
      pipelineName: lead?.pipelineName ?? null,
      stageName: lead?.stageName ?? null,
      opportunityState: (lead?.state ?? null) as DuplicateSideDto['opportunityState'],
      ownerName: lead?.ownerName ?? null,
    };
  };

  return rows.flatMap((r) => {
    let first: DuplicateSideDto | undefined;
    let second: DuplicateSideDto | undefined;
    if (r.kind === 'customer' && r.accountId !== null && r.otherAccountId !== null) {
      first = side(r.accountId, null);
      second = side(r.otherAccountId, null);
    } else if (r.opportunityId !== null && r.otherOpportunityId !== null) {
      const l1 = leadById.get(r.opportunityId);
      const l2 = leadById.get(r.otherOpportunityId);
      first = l1 === undefined ? undefined : side(l1.accountId, l1.id);
      second = l2 === undefined ? undefined : side(l2.accountId, l2.id);
    }
    if (first === undefined || second === undefined) return [];
    return [
      DuplicateRowDto.parse({
        id: r.id,
        entityId: r.entityId,
        kind: r.kind,
        reason: r.reason,
        signals: r.signalsJson,
        confidence: r.confidence,
        state: r.state,
        createdAt: r.createdAt.toISOString(),
        first,
        second,
      }),
    ];
  });
}

/**
 * `/duplicates`: the open candidates of the request's companies the caller sees, surest first and
 * then newest, keyset-paginated by `(confidence, created_at, id)` off `duplicate_candidates_open_idx`.
 * Needs `crm.lead.merge` (a team lead and above).
 */
export async function listDuplicates(ctx: Ctx, rawInput: unknown = {}): Promise<DuplicatePageDto> {
  const input = parseQueryInput(ListDuplicatesInput, rawInput, 'crm.duplicates.list');
  checkPerson(ctx);
  checkPermission(ctx.principal, 'crm.lead.merge', 'team');
  const after = input.cursor === undefined ? undefined : decodeCursor(Cursor, input.cursor);
  if (after !== undefined && !PG_TIME.test(after.t)) {
    throw new DomainError('validation_failed', 'cursor is not valid', { cursor: input.cursor });
  }
  const d = schema.duplicateCandidates;
  const rows = await ctx.tx
    .select({ row: d, createdText: sql<string>`${d.createdAt}::text` })
    .from(d)
    .where(
      and(
        eq(d.state, 'open'),
        inArray(d.entityId, [...ctx.entityIds]),
        input.kind === undefined ? undefined : eq(d.kind, input.kind),
        after === undefined
          ? undefined
          : sql`(${d.confidence}, ${d.createdAt}, ${d.id}) < (${after.c}::smallint, ${after.t}::text::timestamptz, ${after.id}::uuid)`,
        bothLive(),
      ),
    )
    .orderBy(desc(d.confidence), desc(d.createdAt), desc(d.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return DuplicatePageDto.parse({
    items: await withSides(
      ctx,
      page.map((r) => r.row),
    ),
    nextCursor:
      rows.length > input.limit && last !== undefined
        ? encodeCursor({ c: last.row.confidence, t: last.createdText, id: last.row.id })
        : null,
  });
}

/**
 * The duplicate cards of Account 360: the open candidates of the company that name the customer or
 * one of its leads there, and the merges into the customer that can still be undone. Anyone who
 * reads the customer sees the cards they may see; merging, undoing and dismissing need
 * `crm.lead.merge`.
 */
export async function listAccountDuplicates(
  ctx: Ctx,
  rawInput: unknown,
): Promise<AccountDuplicatesDto> {
  const input = parseQueryInput(ListAccountDuplicatesInput, rawInput, 'crm.duplicates.account');
  checkPerson(ctx);
  if (!hasGrant(ctx.principal.permissions, 'crm.account.read', 'own')) {
    checkPermission(ctx.principal, 'crm.lead.read', 'own');
  }
  if (!ctx.entityIds.includes(input.entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', {
      entityId: input.entityId,
    });
  }
  const d = schema.duplicateCandidates;
  const o = schema.opportunities;
  const leadsHere = ctx.tx
    .select({ id: o.id })
    .from(o)
    .where(and(eq(o.accountId, input.accountId), eq(o.entityId, input.entityId)));
  const m = schema.customerMerges;
  const merged = schema.accounts;
  const [candidates, merges] = await Promise.all([
    ctx.tx
      .select()
      .from(d)
      .where(
        and(
          eq(d.entityId, input.entityId),
          eq(d.state, 'open'),
          or(
            eq(d.accountId, input.accountId),
            eq(d.otherAccountId, input.accountId),
            inArray(d.opportunityId, leadsHere),
            inArray(d.otherOpportunityId, leadsHere),
          ),
          bothLive(),
        ),
      )
      .orderBy(desc(d.confidence), desc(d.createdAt), desc(d.id))
      .limit(20),
    ctx.tx
      .select({
        id: m.id,
        entityId: m.entityId,
        mergedAccountId: m.mergedAccountId,
        mergedAccountName: merged.name,
        moved: m.movedJson,
        mergedAt: m.createdAt,
      })
      .from(m)
      .leftJoin(merged, eq(merged.id, m.mergedAccountId))
      .where(and(eq(m.keptAccountId, input.accountId), isNull(m.undoneAt)))
      .orderBy(desc(m.createdAt))
      .limit(20),
  ]);
  return AccountDuplicatesDto.parse({
    candidates: await withSides(ctx, candidates),
    merges: merges.map((x) => ({
      id: x.id,
      entityId: x.entityId,
      mergedAccountId: x.mergedAccountId,
      mergedAccountName: x.mergedAccountName,
      moved: countsOf(x.moved),
      mergedAt: x.mergedAt.toISOString(),
    })),
    canMerge:
      hasGrant(ctx.principal.permissions, 'crm.lead.merge', 'team') &&
      hasGrant(ctx.principal.permissions, 'crm.account.write', 'own'),
  });
}

/** How many of each kind a merge moved, from its record; a list it cannot read counts none. */
function countsOf(value: unknown): CustomerMergeMovedDto {
  const record = typeof value === 'object' && value !== null ? value : {};
  const count = (key: string) => {
    const list = (record as Record<string, unknown>)[key];
    return Array.isArray(list) ? list.length : 0;
  };
  return CustomerMergeMovedDto.parse({
    contacts: count('contacts'),
    sites: count('sites'),
    relationships: count('relationships'),
    leads: count('leads'),
    tasks: count('tasks'),
    tags: count('tags'),
    consents: count('consents'),
    activities: count('activities'),
  });
}

/**
 * What folding `mergedAccountId` into `keptAccountId` would move, counted under the caller's own
 * policies, for the merge dialog to show before anyone confirms. The merge itself is refused when
 * anything it would move lies outside the caller's scope, so a person who may merge sees it all.
 */
export async function previewCustomerMerge(
  ctx: Ctx,
  rawInput: unknown,
): Promise<CustomerMergeMovedDto> {
  const input = parseQueryInput(PreviewCustomerMergeInput, rawInput, 'crm.duplicates.preview');
  checkPerson(ctx);
  checkPermission(ctx.principal, 'crm.lead.merge', 'team');
  if (!ctx.entityIds.includes(input.entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', {
      entityId: input.entityId,
    });
  }
  const kept = input.keptAccountId;
  const from = input.mergedAccountId;
  const [row] = (await ctx.tx.execute(sql`
    with moving_contacts as (
      select ac.contact_id from account_contacts ac
       where ac.account_id = ${from}::uuid
         and not exists (select 1 from account_contacts k
                          where k.account_id = ${kept}::uuid and k.contact_id = ac.contact_id))
    select
      (select count(*) from moving_contacts)::int as contacts,
      (select count(*) from customer_sites cs where cs.account_id = ${from}::uuid)::int as sites,
      (select count(*) from account_entities ae
        where ae.account_id = ${from}::uuid
          and not exists (select 1 from account_entities k
                           where k.account_id = ${kept}::uuid and k.entity_id = ae.entity_id))::int
        as relationships,
      (select count(*) from opportunities o where o.account_id = ${from}::uuid)::int as leads,
      (select count(*) from tasks t where t.account_id = ${from}::uuid)::int as tasks,
      (select count(*) from opportunity_tags ot where ot.account_id = ${from}::uuid)::int as tags,
      (select count(*) from consents c
        where c.contact_id in (select contact_id from moving_contacts))::int as consents,
      (select count(*) from activities a where a.account_id = ${from}::uuid)::int as activities
  `)) as unknown as Record<string, number>[];
  return CustomerMergeMovedDto.parse(row ?? {});
}
