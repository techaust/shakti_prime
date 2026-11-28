import {
  SyncMilestoneRecord,
  SyncProjectRecord,
  SyncReferenceRecord,
  SyncSiteRecord,
  type BuiltSyncCollection,
} from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { AnyCommand } from '../command/define-command';
import { upsertSite } from '../commands/crm/customer';
import { completeMilestone } from '../commands/projects/move-project';
import type { ConflictRule, FieldStamp } from './conflicts';
import { isoText, memberProjects } from './source';

/**
 * The field app's collections (docs/03-roadmap-appendix/phase4.md §7.4, ADR 0012): what the phone
 * keeps offline and which commands it may push for it. Each entry names
 * - its record (the strict DTO a pull's upsert and a conflict's server record carry);
 * - its scope rule, in words and as its source (`source.ts`): the rows of the person's working set,
 *   read under the person's own row security;
 * - its conflict rule (`conflicts.ts`);
 * - the commands the app may push for it, each run through `executeCommand()` as the person.
 *
 * F2 registers `reference`, `projects`, `project_milestones` and `customer_sites`. A later slice
 * adds its collection with one entry here and its record in `@shakti/contracts`
 * (`sync-records.ts`). The order is the pull's: reference data first, then each record after the
 * one it hangs from. A `code` names the collection in the cursor; a new shape of the record takes
 * a new code, so every phone reads that collection again from its start.
 */

/** A raw row of a source, as the driver answers it, keyed by column name. */
export type SourceRow = Record<string, unknown>;

/**
 * An edit that merges field by field (rule `fields`): which fields the input sets, the record's
 * current values and stamps as the person reads them, and the input narrowed to the fields kept.
 */
export interface FieldMerge {
  /** The fields the input sets, by name, as `server` gives them, so the two compare. */
  sent(input: Readonly<Record<string, unknown>>): Record<string, unknown>;
  server(
    tx: RequestTx,
    input: Readonly<Record<string, unknown>>,
  ): Promise<
    | {
        values: Record<string, unknown>;
        stamps: Record<string, FieldStamp | undefined>;
      }
    | undefined
  >;
  /** The input with only `keep` of its fields set; a required field takes the server's value. */
  narrow(
    input: Readonly<Record<string, unknown>>,
    keep: ReadonlySet<string>,
    server: Readonly<Record<string, unknown>>,
  ): Record<string, unknown>;
}

export interface SyncCommandSpec {
  command: AnyCommand;
  merge?: FieldMerge;
}

export interface SyncCollectionSpec {
  collection: BuiltSyncCollection;
  /** Two letters and a version: the collection's name in the cursor. */
  code: string;
  record: z.ZodType;
  /** The scope rule in words, for the documents and the review. */
  scope: string;
  source: () => SQL;
  /** The records of a page's rows, in the rows' order. */
  toRecords: (tx: RequestTx, rows: readonly SourceRow[]) => Promise<unknown[]>;
  conflict: ConflictRule;
  commands: readonly SyncCommandSpec[];
}

const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number.parseFloat(String(v));
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

// ---- reference --------------------------------------------------------------------------------

const reference: SyncCollectionSpec = {
  collection: 'reference',
  code: 'rf1',
  record: SyncReferenceRecord,
  scope:
    'The companies of the request, each with the segments of its active pipelines, and every active stocked item of the catalogue.',
  source: () => sql`
    select ('00000000-0000-7000-8000-' || pg_catalog.lpad(pg_catalog.to_hex(e.id), 12, '0'))::uuid as id,
           e.created_at as since,
           greatest(e.updated_at,
                    (select max(pl.updated_at) from public.pipelines pl
                      where pl.entity_id is null or pl.entity_id = e.id)) as changed_at,
           'company'::text as kind, e.id::int as entity_id, e.code, e.brand_name,
           (select coalesce(pg_catalog.jsonb_agg(distinct pl.segment), '[]'::jsonb)
              from public.pipelines pl
             where (pl.entity_id is null or pl.entity_id = e.id)
               and pl.is_active and pl.archived_at is null) as segments,
           null::text as sku, null::text as name, null::text as category, null::text as unit,
           null::boolean as is_serial_tracked, null::text as barcode, null::text as serial_pattern
      from public.entities e
     where e.archived_at is null
    union all
    select i.id, i.created_at, i.updated_at, 'item', null, null, null, null,
           i.sku, i.name, i.category, i.unit, i.is_serial_tracked, i.barcode, i.serial_pattern
      from public.items i
     where i.is_active and i.is_stocked and i.archived_at is null`,
  toRecords: (_tx, rows) =>
    Promise.resolve(
      rows.map((r) =>
        r.kind === 'company'
          ? {
              kind: 'company',
              entityId: r.entity_id,
              code: r.code,
              brandName: r.brand_name,
              segments: strings(r.segments).sort(),
            }
          : {
              kind: 'item',
              sku: r.sku,
              name: r.name,
              category: r.category,
              unit: r.unit,
              isSerialTracked: r.is_serial_tracked,
              barcode: text(r.barcode),
              serialPattern: text(r.serial_pattern),
            },
      ),
    ),
  conflict: 'none',
  commands: [],
};

// ---- projects ---------------------------------------------------------------------------------

/** The customer and village of the projects (`app.project_customers()`, J1), and who is on them. */
async function projectFacts(tx: RequestTx, ids: readonly string[]) {
  if (ids.length === 0) return { customers: new Map(), people: new Map<string, string[]>() };
  const customers = (await tx.execute(
    sql`select project_id, account_name, village
          from app.project_customers(${`{${ids.join(',')}}`}::uuid[])`,
  )) as unknown as { project_id: string; account_name: string; village: string | null }[];
  const a = schema.projectAssignments;
  const assigned = await tx
    .select({ projectId: a.projectId, personId: a.personId })
    .from(a)
    .where(inArray(a.projectId, [...ids]));
  const people = new Map<string, string[]>();
  for (const row of assigned) {
    people.set(row.projectId, [...(people.get(row.projectId) ?? []), row.personId]);
  }
  return {
    customers: new Map(customers.map((c) => [c.project_id, c])),
    people,
  };
}

const projects: SyncCollectionSpec = {
  collection: 'projects',
  code: 'pr1',
  record: SyncProjectRecord,
  scope:
    'The projects the person runs or is on, live or finished within the named window, under projects_read.',
  source: () => sql`
    select p.id, p.created_at as since, p.updated_at as changed_at, p.entity_id::int as entity_id,
           p.project_no, p.sales_order_id, p.account_id, p.site_id, p.segment, p.scheme, p.flow,
           p.state, ${isoText(sql`p.state_changed_at`)} as state_changed_at, p.owner_id,
           p.hold_reason, p.cancel_reason
      from (${memberProjects()}) p`,
  async toRecords(tx, rows) {
    const facts = await projectFacts(
      tx,
      rows.map((r) => String(r.id)),
    );
    return rows.map((r) => {
      const customer = facts.customers.get(String(r.id)) as
        | { account_name: string; village: string | null }
        | undefined;
      return {
        entityId: r.entity_id,
        projectNo: r.project_no,
        salesOrderId: r.sales_order_id,
        accountId: r.account_id,
        customerName: customer?.account_name ?? null,
        village: customer?.village ?? null,
        siteId: text(r.site_id),
        segment: r.segment,
        scheme: r.scheme,
        flow: r.flow,
        state: r.state,
        stateChangedAt: r.state_changed_at,
        ownerId: text(r.owner_id),
        holdReason: text(r.hold_reason),
        cancelReason: text(r.cancel_reason),
        assigneeIds: (facts.people.get(String(r.id)) ?? []).sort(),
      };
    });
  },
  conflict: 'state',
  commands: [],
};

// ---- project_milestones -----------------------------------------------------------------------

const projectMilestones: SyncCollectionSpec = {
  collection: 'project_milestones',
  code: 'pm1',
  record: SyncMilestoneRecord,
  scope:
    'The steps of the projects in the working set; a step changes with its project, which every step command writes.',
  source: () => sql`
    select m.id, m.created_at as since,
           greatest(m.created_at, m.done_at, p.updated_at) as changed_at,
           m.entity_id::int as entity_id, m.project_id, m.position::int as position, m.key, m.title,
           m.state, m.skip_reason, m.requires, ${isoText(sql`m.done_at`)} as done_at, m.done_by
      from public.project_milestones m
      join (${memberProjects()}) p on p.id = m.project_id`,
  toRecords: (_tx, rows) =>
    Promise.resolve(
      rows.map((r) => ({
        entityId: r.entity_id,
        projectId: r.project_id,
        position: r.position,
        key: r.key,
        title: text(r.title),
        state: r.state,
        skipReason: text(r.skip_reason),
        requires: strings(r.requires),
        doneAt: text(r.done_at),
        doneBy: text(r.done_by),
      })),
    ),
  conflict: 'state',
  commands: [{ command: completeMilestone }],
};

// ---- customer_sites ---------------------------------------------------------------------------

/** The site fields an edit sets, as `crm.site.upsert` names them. */
const SITE_FIELDS = [
  'type',
  'address',
  'village',
  'tehsil',
  'district',
  'pin',
  'stateCode',
  'location',
] as const;

/** A map point as the column keeps it: six decimals. */
const point = (lat: unknown, lng: unknown): { lat: number; lng: number } | null =>
  lat === null || lat === undefined || lng === null || lng === undefined
    ? null
    : { lat: Number(Number(lat).toFixed(6)), lng: Number(Number(lng).toFixed(6)) };

function stampsOf(value: unknown): Record<string, FieldStamp | undefined> {
  if (typeof value !== 'object' || value === null) return {};
  const stamps: Record<string, FieldStamp | undefined> = {};
  for (const [field, raw] of Object.entries(value as Record<string, unknown>)) {
    const s = raw as { at?: unknown; by?: unknown } | null;
    if (typeof s?.at === 'string') stamps[field] = { at: s.at, by: text(s.by) };
  }
  return stamps;
}

/**
 * `crm.site.upsert` from the phone merges field by field: the site's values and stamps are read as
 * the person reads the site (its customer's row security), and a field someone else changed later
 * is left as the server has it.
 */
const siteMerge: FieldMerge = {
  sent(input) {
    const sent: Record<string, unknown> = {};
    for (const field of SITE_FIELDS) {
      if (input[field] === undefined) continue;
      if (field === 'location') {
        const loc = input.location as { lat: number; lng: number } | null;
        sent.location = loc === null ? null : point(loc.lat, loc.lng);
      } else {
        sent[field] = input[field];
      }
    }
    return sent;
  },
  async server(tx, input) {
    if (typeof input.siteId !== 'string' || typeof input.accountId !== 'string') return undefined;
    const cs = schema.customerSites;
    const [site] = await tx
      .select({
        type: cs.type,
        address: cs.address,
        village: cs.village,
        tehsil: cs.tehsil,
        district: cs.district,
        pin: cs.pin,
        stateCode: cs.stateCode,
        lat: cs.lat,
        lng: cs.lng,
        stamps: cs.fieldChangedAt,
      })
      .from(cs)
      .where(
        and(eq(cs.id, input.siteId), eq(cs.accountId, input.accountId), isNull(cs.archivedAt)),
      )
      .limit(1);
    if (site === undefined) return undefined;
    const { lat, lng, stamps, ...rest } = site;
    return { values: { ...rest, location: point(lat, lng) }, stamps: stampsOf(stamps) };
  },
  narrow(input, keep, server) {
    const narrowed: Record<string, unknown> = { ...input };
    for (const field of SITE_FIELDS) {
      if (keep.has(field)) continue;
      if (field === 'type') narrowed.type = server.type;
      else delete narrowed[field];
    }
    return narrowed;
  },
};

const customerSites: SyncCollectionSpec = {
  collection: 'customer_sites',
  code: 'cs1',
  record: SyncSiteRecord,
  scope:
    'The sites of the projects in the working set, through app.sync_project_sites(): the place, never an address line or a phone number.',
  source: () => sql`
    select s.id, greatest(s.created_at, min(s.project_created_at)) as since,
           greatest(s.updated_at, max(s.project_created_at)) as changed_at,
           s.account_id, s.type, s.village, s.tehsil, s.district, s.pin, s.state_code,
           s.lat::float8 as lat, s.lng::float8 as lng, s.archived_at is not null as archived
      from app.sync_project_sites(array(select p.id from (${memberProjects()}) p)) s
     group by s.id, s.account_id, s.type, s.village, s.tehsil, s.district, s.pin, s.state_code,
              s.lat, s.lng, s.archived_at, s.created_at, s.updated_at`,
  toRecords: (_tx, rows) =>
    Promise.resolve(
      rows.map((r) => ({
        accountId: r.account_id,
        type: r.type,
        village: text(r.village),
        tehsil: text(r.tehsil),
        district: text(r.district),
        pin: text(r.pin),
        stateCode: text(r.state_code),
        lat: num(r.lat),
        lng: num(r.lng),
        archived: r.archived === true,
      })),
    ),
  conflict: 'fields',
  commands: [{ command: upsertSite, merge: siteMerge }],
};

/** The collections built, in the pull's order. */
export const SYNC_REGISTRY: readonly SyncCollectionSpec[] = Object.freeze([
  reference,
  projects,
  projectMilestones,
  customerSites,
]);

/** The collection and spec of a command the app may push, by the command's name. */
export function pushableCommand(
  name: string,
): { collection: SyncCollectionSpec; spec: SyncCommandSpec } | undefined {
  for (const collection of SYNC_REGISTRY) {
    const spec = collection.commands.find((c) => c.command.name === name);
    if (spec !== undefined) return { collection, spec };
  }
  return undefined;
}
