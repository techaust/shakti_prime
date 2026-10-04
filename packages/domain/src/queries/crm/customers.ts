import {
  Account360Dto,
  ActivityDto,
  ConsentDto,
  CUSTOMER_SEARCH_MAX,
  CustomerRowDto,
  DomainError,
  hasGrant,
  IdSchema,
  ListCustomersInput,
  ListMyTasksInput,
  ListTimelineInput,
  LoadAccount360Input,
  MyTaskDto,
  TagDto,
  TaskDto,
  type ActivityDto as Activity,
  type CustomerPageDto,
  type MyTaskPageDto,
  type TimelinePageDto,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, desc, eq, exists, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { checkPermission, isAgent } from '../../command/run-command';
import {
  afterCursor,
  keysetOrder,
  nextCursor,
  orderTerms,
  sortText,
  type SortKeys,
} from '../keyset-sort';
import { decodeCursor, encodeCursor, parseQueryInput } from '../parse-input';
import { containsPattern, phoneDigits } from '../search-text';

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/** The typed digits backwards, the prefix of `contact_phones.e164_reversed` they end. */
function reversed(digits: string): string {
  let out = '';
  for (const d of digits) out = d + out;
  return out;
}

/** An id no customer has, for a search that found none (an empty `in` list is not valid SQL). */
const NO_CUSTOMER = '00000000-0000-7000-8000-000000000000';

const CUSTOMER_SORT_KEYS: SortKeys<'name'> = {
  name: { expr: schema.accounts.name, type: 'text', nullable: false },
};

/**
 * Either customer read or lead read at own scope or wider opens the customers screens; an agent
 * never does (docs/SECURITY.md §3.3: agents work on leads without customers' names or phones).
 */
function checkCustomerRead(ctx: Ctx): void {
  if (isAgent(ctx.principal)) {
    throw new DomainError('forbidden', 'the customers screens are for people, not agents');
  }
  const perms = ctx.principal.permissions;
  if (hasGrant(perms, 'crm.account.read', 'own')) return;
  checkPermission(ctx.principal, 'crm.lead.read', 'own');
}

/**
 * The customers list (`/customers`): one row per customer and company of the request the caller
 * reads (`account_entities_read`, 0057: their customer scope, or a lead of the customer there),
 * by name, keyset-paginated by `(name, id)`. `q` finds the customer's name, a contact's name or a
 * village holding the text, or a phone ending in the typed digits, at most 200 customers a search
 * (`CUSTOMER_SEARCH_MAX`, `truncated` when it found more). A phone shows only its last four digits in the list.
 */
export async function listCustomers(ctx: Ctx, rawInput: unknown = {}): Promise<CustomerPageDto> {
  const input = parseQueryInput(ListCustomersInput, rawInput, 'crm.customers.list');
  checkCustomerRead(ctx);
  const a = schema.accounts;
  const ae = schema.accountEntities;
  const ac = schema.accountContacts;
  const c = schema.contacts;
  const cs = schema.customerSites;
  const ph = schema.contactPhones;
  const order = keysetOrder(CUSTOMER_SORT_KEYS, ae.id, input.sort, {
    column: 'name',
    direction: 'asc',
  });

  let found: SQL | undefined;
  let truncated = false;
  if (input.q !== undefined) {
    const pattern = containsPattern(input.q);
    const digits = phoneDigits(input.q);
    // Each test is tied to the customer row, so it runs only for the few candidates below.
    const byContact = exists(
      ctx.tx
        .select({ one: sql`1` })
        .from(ac)
        .innerJoin(c, eq(c.id, ac.contactId))
        .where(and(eq(ac.accountId, a.id), ilike(c.name, pattern))),
    );
    const byVillage = exists(
      ctx.tx
        .select({ one: sql`1` })
        .from(cs)
        .where(and(eq(cs.accountId, a.id), ilike(cs.village, pattern), isNull(cs.archivedAt))),
    );
    const byPhone =
      digits === undefined
        ? undefined
        : exists(
            ctx.tx
              .select({ one: sql`1` })
              .from(ph)
              .innerJoin(ac, eq(ac.contactId, ph.contactId))
              .where(and(eq(ac.accountId, a.id), sql`${ph.e164Reversed} ^@ ${reversed(digits)}`)),
          );
    // The candidates come through the indexes from app.customer_search_ids(), which keeps
    // to the customers the caller may read; this query then tests each against every condition
    // above under the policies, so the search finds exactly what it did without the lookup.
    const [lookup] = (await ctx.tx.execute(sql`
      select coalesce(array_agg(candidate), '{}') as ids
        from app.customer_search_ids(${input.q}::text,
                                     ${digits === undefined ? null : reversed(digits)}::text,
                                     ${CUSTOMER_SEARCH_MAX + 1}::integer) as candidate`)) as unknown as {
      ids: string[];
    }[];
    const ids = lookup?.ids ?? [];
    truncated = ids.length > CUSTOMER_SEARCH_MAX;
    found = and(
      inArray(a.id, ids.length === 0 ? [NO_CUSTOMER] : ids.slice(0, CUSTOMER_SEARCH_MAX)),
      or(ilike(a.name, pattern), byContact, byVillage, byPhone),
    );
  }

  const rows = await ctx.tx
    .select({
      id: ae.id,
      accountId: a.id,
      entityId: ae.entityId,
      name: a.name,
      type: a.type,
      ownerId: ae.ownerId,
      sortValue: sortText(order),
    })
    .from(ae)
    .innerJoin(a, eq(a.id, ae.accountId))
    .where(
      and(
        inArray(ae.entityId, [...ctx.entityIds]),
        isNull(a.archivedAt),
        found,
        afterCursor(order, input.cursor),
      ),
    )
    .orderBy(...orderTerms(order))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const details = await rowDetails(ctx, page);
  const last = page.at(-1);
  return {
    items: page.map((r) => {
      const d = details(r.accountId, r.entityId, r.ownerId);
      return CustomerRowDto.parse({
        id: r.id,
        accountId: r.accountId,
        entityId: r.entityId,
        name: r.name,
        type: r.type,
        ownerId: r.ownerId,
        ...d,
      });
    }),
    nextCursor: nextCursor(
      order,
      rows.length > input.limit,
      last === undefined ? undefined : { value: last.sortValue, id: last.id },
    ),
    truncated,
  };
}

/** The owner contact, main phone, first site's village, owner name and open leads of a page. */
async function rowDetails(
  ctx: Ctx,
  page: readonly { accountId: string; entityId: number; ownerId: string | null }[],
) {
  const accountIds = [...new Set(page.map((r) => r.accountId))];
  const ownerIds = [...new Set(page.flatMap((r) => (r.ownerId === null ? [] : [r.ownerId])))];
  const ac = schema.accountContacts;
  const c = schema.contacts;
  const ph = schema.contactPhones;
  const cs = schema.customerSites;
  const o = schema.opportunities;
  const p = schema.principals;
  const [contacts, villages, leads, owners] =
    accountIds.length === 0
      ? [[], [], [], []]
      : await Promise.all([
          ctx.tx
            .select({ accountId: ac.accountId, name: c.name, phone: ph.e164 })
            .from(ac)
            .innerJoin(c, eq(c.id, ac.contactId))
            .leftJoin(ph, and(eq(ph.contactId, c.id), eq(ph.isPrimary, true)))
            .where(and(inArray(ac.accountId, accountIds), eq(ac.role, 'owner'))),
          ctx.tx
            .selectDistinctOn([cs.accountId], { accountId: cs.accountId, village: cs.village })
            .from(cs)
            .where(and(inArray(cs.accountId, accountIds), isNull(cs.archivedAt)))
            .orderBy(cs.accountId, cs.createdAt, cs.id),
          ctx.tx
            .select({
              accountId: o.accountId,
              entityId: o.entityId,
              n: sql<number>`count(*)::int`,
            })
            .from(o)
            .where(
              and(
                inArray(o.accountId, accountIds),
                inArray(o.state, ['open', 'nurture']),
                isNull(o.archivedAt),
              ),
            )
            .groupBy(o.accountId, o.entityId),
          ownerIds.length === 0
            ? []
            : ctx.tx
                .select({ id: p.id, name: p.displayName })
                .from(p)
                .where(inArray(p.id, ownerIds)),
        ]);
  return (accountId: string, entityId: number, ownerId: string | null) => {
    const contact = contacts.find((x) => x.accountId === accountId);
    return {
      contactName: contact?.name ?? null,
      phoneLast4: contact?.phone == null ? null : contact.phone.slice(-4),
      village: villages.find((x) => x.accountId === accountId)?.village ?? null,
      ownerName: owners.find((x) => x.id === ownerId)?.name ?? null,
      openLeads: leads.find((x) => x.accountId === accountId && x.entityId === entityId)?.n ?? 0,
    };
  };
}

/** The position after a timeline row: its time as Postgres text (microseconds kept) and id. */
const TimelineCursor = z.object({ t: z.string().max(40), id: IdSchema }).strict();
const PG_TIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;

/**
 * A page of a customer's timeline in one company, or of one lead's, newest first, keyset on
 * `(created_at, id)` (docs/DATABASE.md §7), which `activities_account_created_idx` and
 * `activities_opportunity_created_idx` serve in every monthly partition. RLS decides the rows: a
 * lead's rows with the lead, a customer's own with the customer (never to an agent through a
 * lead, 0057).
 */
export async function listTimeline(ctx: Ctx, rawInput: unknown): Promise<TimelinePageDto> {
  const input = parseQueryInput(ListTimelineInput, rawInput, 'crm.timeline.list');
  checkCustomerRead(ctx);
  if (!ctx.entityIds.includes(input.entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', {
      entityId: input.entityId,
    });
  }
  const act = schema.activities;
  const p = schema.principals;
  const after = input.cursor === undefined ? undefined : decodeCursor(TimelineCursor, input.cursor);
  if (after !== undefined && !PG_TIME.test(after.t)) {
    throw new DomainError('validation_failed', 'cursor is not valid', { cursor: input.cursor });
  }
  const rows = await ctx.tx
    .select({
      id: act.id,
      type: act.type,
      opportunityId: act.opportunityId,
      actorId: act.actorPrincipalId,
      actorName: p.displayName,
      payload: act.payloadJson,
      body: act.body,
      createdAt: act.createdAt,
      createdText: sql<string>`${act.createdAt}::text`,
    })
    .from(act)
    .leftJoin(p, eq(p.id, act.actorPrincipalId))
    .where(
      and(
        eq(act.entityId, input.entityId),
        input.accountId === undefined
          ? eq(act.opportunityId, input.opportunityId ?? '')
          : eq(act.accountId, input.accountId),
        after === undefined
          ? undefined
          : sql`(${act.createdAt}, ${act.id}) < (${after.t}::text::timestamptz, ${after.id}::uuid)`,
      ),
    )
    .orderBy(desc(act.createdAt), desc(act.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  // A row keeps a tag's id only; its name is read now, under the caller's own policies.
  const tagIds = [
    ...new Set(
      page.flatMap((r) => {
        const tagId = (r.payload as Record<string, unknown>).tagId;
        return typeof tagId === 'string' && IdSchema.safeParse(tagId).success ? [tagId] : [];
      }),
    ),
  ];
  const tagNames =
    tagIds.length === 0
      ? new Map<string, string>()
      : new Map(
          (
            await ctx.tx
              .select({ id: schema.tags.id, name: schema.tags.name })
              .from(schema.tags)
              .where(inArray(schema.tags.id, tagIds))
          ).map((t) => [t.id, t.name]),
        );
  const withNames = (payload: unknown): Record<string, unknown> => {
    const p = payload as Record<string, unknown>;
    const name = typeof p.tagId === 'string' ? tagNames.get(p.tagId) : undefined;
    return name === undefined ? p : { ...p, tagName: name };
  };
  return {
    items: page.map((r): Activity =>
      ActivityDto.parse({
        id: r.id,
        type: r.type,
        opportunityId: r.opportunityId,
        actorId: r.actorId,
        actorName: r.actorName,
        payload: withNames(r.payload),
        body: r.body,
        createdAt: r.createdAt.toISOString(),
      }),
    ),
    nextCursor:
      rows.length > input.limit && last !== undefined
        ? encodeCursor({ t: last.createdText, id: last.id })
        : null,
  };
}

/** The live tags that may go on a lead of the company: its own and the group's. */
async function tagsFor(ctx: Ctx, entityId: number) {
  const t = schema.tags;
  const rows = await ctx.tx
    .select()
    .from(t)
    .where(and(isNull(t.archivedAt), or(eq(t.entityId, entityId), isNull(t.entityId))))
    .orderBy(asc(t.name))
    .limit(200);
  return rows.map((row) =>
    TagDto.parse({
      id: row.id,
      entityId: row.entityId,
      name: row.name,
      archivedAt: null,
    }),
  );
}

/**
 * Account 360 (`/customers/[accountId]`, CRM-07): the customer as one company of the request
 * deals with them, the company asked for or else the first where the caller reads the customer:
 * contacts with their phones, sites, leads with their stage, owner and tags, open tasks, consents,
 * the tags to choose from and the first page of the timeline. Everything is read under the
 * caller's own policies; a customer the caller cannot read in that company is not found.
 */
export async function loadAccount360(ctx: Ctx, rawInput: unknown): Promise<Account360Dto> {
  const input = parseQueryInput(LoadAccount360Input, rawInput, 'crm.account.load360');
  checkCustomerRead(ctx);
  const a = schema.accounts;
  const ae = schema.accountEntities;
  const relationships = await ctx.tx
    .select({
      entityId: ae.entityId,
      ownerId: ae.ownerId,
      teamId: ae.teamId,
      account: {
        id: a.id,
        name: a.name,
        type: a.type,
        gstin: a.gstin,
        billingStateCode: a.billingStateCode,
      },
    })
    .from(ae)
    .innerJoin(a, eq(a.id, ae.accountId))
    .where(
      and(
        eq(ae.accountId, input.accountId),
        inArray(ae.entityId, [...ctx.entityIds]),
        isNull(a.archivedAt),
      ),
    )
    .orderBy(asc(ae.entityId));
  const here =
    input.entityId === undefined
      ? relationships[0]
      : relationships.find((r) => r.entityId === input.entityId);
  if (here === undefined) {
    throw new DomainError('not_found', `account ${input.accountId} is not visible`, {
      reason: 'account_missing',
    });
  }
  const entityId = here.entityId;
  const accountId = here.account.id;

  const ac = schema.accountContacts;
  const c = schema.contacts;
  const ph = schema.contactPhones;
  const cs = schema.customerSites;
  const o = schema.opportunities;
  const pl = schema.pipelines;
  const ps = schema.pipelineStages;
  const p = schema.principals;
  const t = schema.tasks;
  const con = schema.consents;
  const ot = schema.opportunityTags;
  const tg = schema.tags;

  const [contacts, phones, sites, leads, tasks, consents, leadTags, tags, timeline, owner] =
    await Promise.all([
      ctx.tx
        .select({
          id: c.id,
          role: ac.role,
          name: c.name,
          email: c.email,
          preferredLanguage: c.preferredLanguage,
        })
        .from(ac)
        .innerJoin(c, eq(c.id, ac.contactId))
        .where(and(eq(ac.accountId, accountId), isNull(c.archivedAt)))
        .orderBy(sql`${ac.role} <> 'owner'`, asc(c.name)),
      ctx.tx
        .select({
          id: ph.id,
          contactId: ph.contactId,
          e164: ph.e164,
          isPrimary: ph.isPrimary,
          isWhatsapp: ph.isWhatsapp,
          isDnd: ph.isDnd,
        })
        .from(ph)
        .innerJoin(ac, eq(ac.contactId, ph.contactId))
        .where(eq(ac.accountId, accountId))
        .orderBy(desc(ph.isPrimary), asc(ph.createdAt), asc(ph.id)),
      ctx.tx
        .select()
        .from(cs)
        .where(and(eq(cs.accountId, accountId), isNull(cs.archivedAt)))
        .orderBy(asc(cs.createdAt), asc(cs.id)),
      ctx.tx
        .select({
          id: o.id,
          pipelineName: pl.name,
          stageName: ps.name,
          state: o.state,
          ownerId: o.ownerId,
          ownerName: p.displayName,
          updatedAt: o.updatedAt,
        })
        .from(o)
        .innerJoin(pl, eq(pl.id, o.pipelineId))
        .innerJoin(ps, eq(ps.id, o.stageId))
        .leftJoin(p, eq(p.id, o.ownerId))
        .where(and(eq(o.accountId, accountId), eq(o.entityId, entityId), isNull(o.archivedAt)))
        .orderBy(desc(o.updatedAt), desc(o.id))
        .limit(50),
      ctx.tx
        .select({ task: t, assigneeName: p.displayName })
        .from(t)
        .leftJoin(p, eq(p.id, t.assigneeId))
        .where(and(eq(t.accountId, accountId), eq(t.entityId, entityId), eq(t.state, 'open')))
        .orderBy(asc(t.dueAt), asc(t.id))
        .limit(50),
      ctx.tx
        .select({ consent: con, readableEvidence: schema.files.id })
        .from(con)
        .innerJoin(ac, eq(ac.contactId, con.contactId))
        // The proof file under the files policies: null when the caller may not open it.
        .leftJoin(schema.files, eq(schema.files.id, con.evidenceFileId))
        .where(eq(ac.accountId, accountId))
        .orderBy(desc(con.givenAt), desc(con.id)),
      ctx.tx
        .select({ opportunityId: ot.opportunityId, id: tg.id, name: tg.name })
        .from(ot)
        .innerJoin(tg, eq(tg.id, ot.tagId))
        .innerJoin(o, eq(o.id, ot.opportunityId))
        .where(and(eq(o.accountId, accountId), eq(ot.entityId, entityId)))
        .orderBy(asc(tg.name)),
      tagsFor(ctx, entityId),
      listTimeline(ctx, { entityId, accountId }),
      here.ownerId === null
        ? []
        : ctx.tx.select({ name: p.displayName }).from(p).where(eq(p.id, here.ownerId)).limit(1),
    ]);

  const perms = ctx.principal.permissions;
  const covers = (key: 'crm.account.write' | 'crm.lead.write') =>
    hasGrant(perms, key, 'entity') ||
    (hasGrant(perms, key, 'team') &&
      here.teamId !== null &&
      here.teamId === ctx.principal.teamId) ||
    (hasGrant(perms, key, 'own') && here.ownerId === ctx.principal.id);

  return Account360Dto.parse({
    account: here.account,
    entityId,
    otherEntityIds: relationships.map((r) => r.entityId).filter((e) => e !== entityId),
    ownerId: here.ownerId,
    ownerName: owner[0]?.name ?? null,
    canEdit: covers('crm.account.write'),
    canWorkLeads: hasGrant(perms, 'crm.lead.write', 'own'),
    canManageTags: hasGrant(perms, 'crm.lead.assign', 'own'),
    contacts: contacts.map((x) => ({
      ...x,
      phones: phones
        .filter((q) => q.contactId === x.id)
        .map((q) => ({
          id: q.id,
          e164: q.e164,
          isPrimary: q.isPrimary,
          isWhatsapp: q.isWhatsapp,
          isDnd: q.isDnd,
        })),
    })),
    sites: sites.map((s) => ({
      id: s.id,
      type: s.type,
      address: s.address,
      village: s.village,
      tehsil: s.tehsil,
      district: s.district,
      pin: s.pin,
      stateCode: s.stateCode,
      lat: s.lat === null ? null : Number(s.lat),
      lng: s.lng === null ? null : Number(s.lng),
    })),
    leads: leads.map((l) => ({
      ...l,
      updatedAt: l.updatedAt.toISOString(),
      tags: leadTags
        .filter((x) => x.opportunityId === l.id)
        .map((x) => ({ id: x.id, name: x.name })),
    })),
    tasks: tasks.map((x) => ({
      ...taskDto(x.task),
      assigneeName: x.assigneeName,
    })),
    consents: consents.map((x) => consentDto(x.consent, x.readableEvidence)),
    tags,
    timeline,
  });
}

function taskDto(row: typeof schema.tasks.$inferSelect): TaskDto {
  return TaskDto.parse({
    id: row.id,
    entityId: row.entityId,
    opportunityId: row.opportunityId,
    accountId: row.accountId,
    assigneeId: row.assigneeId,
    teamId: row.teamId,
    kind: row.kind,
    title: row.title,
    dueAt: row.dueAt.toISOString(),
    state: row.state,
    doneAt: row.doneAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  });
}

function consentDto(
  row: typeof schema.consents.$inferSelect,
  readableEvidence: string | null,
): ConsentDto {
  return ConsentDto.parse({
    id: row.id,
    contactId: row.contactId,
    channel: row.channel,
    purpose: row.purpose,
    source: row.source,
    textVersion: row.textVersion,
    givenAt: row.givenAt.toISOString(),
    withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
    hasEvidence: row.evidenceFileId !== null,
    evidenceFileId: readableEvidence,
  });
}

const MyTasksCursor = z.object({ t: z.string().max(40), id: IdSchema }).strict();

/**
 * The caller's open tasks in the request's companies, soonest due first, keyset on
 * `(due_at, id)`, which `tasks_assignee_state_due_idx` serves.
 */
export async function listMyTasks(ctx: Ctx, rawInput: unknown = {}): Promise<MyTaskPageDto> {
  const input = parseQueryInput(ListMyTasksInput, rawInput, 'crm.tasks.mine');
  checkPermission(ctx.principal, 'crm.lead.read', 'own');
  const t = schema.tasks;
  const a = schema.accounts;
  const after = input.cursor === undefined ? undefined : decodeCursor(MyTasksCursor, input.cursor);
  if (after !== undefined && !PG_TIME.test(after.t)) {
    throw new DomainError('validation_failed', 'cursor is not valid', { cursor: input.cursor });
  }
  const rows = await ctx.tx
    .select({ task: t, accountName: a.name, dueText: sql<string>`${t.dueAt}::text` })
    .from(t)
    .innerJoin(a, eq(a.id, t.accountId))
    .where(
      and(
        eq(t.assigneeId, ctx.principal.id),
        eq(t.state, 'open'),
        inArray(t.entityId, [...ctx.entityIds]),
        after === undefined
          ? undefined
          : sql`(${t.dueAt}, ${t.id}) > (${after.t}::text::timestamptz, ${after.id}::uuid)`,
      ),
    )
    .orderBy(asc(t.dueAt), asc(t.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => MyTaskDto.parse({ ...taskDto(r.task), accountName: r.accountName })),
    nextCursor:
      rows.length > input.limit && last !== undefined
        ? encodeCursor({ t: last.dueText, id: last.task.id })
        : null,
  };
}
