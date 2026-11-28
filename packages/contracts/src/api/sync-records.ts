import { z } from 'zod';
import { ItemCategorySchema, ItemUnitSchema } from '../catalogue/enums';
import { SegmentSchema, SiteTypeSchema } from '../crm/enums';
import { SubsidySchemeSchema } from '../crm/sizing';
import { EntityIdSchema, IdSchema } from '../ids';
import {
  MilestoneStateSchema,
  ProjectFlowSchema,
  ProjectSegmentSchema,
  ProjectStateSchema,
} from '../projects/enums';
import { StepKeySchema } from '../projects/projects';
import type { SyncCollection } from './sync';

/**
 * The records of the field app's collections (docs/03-roadmap-appendix/phase4.md §7.4): what a
 * pull's `upsert` carries as `record` and a conflict as `server`, each strict, so nothing beyond
 * what the phone keeps leaves the server. The record's id travels beside it in the envelope. F2
 * contracts `projects`, `project_milestones`, `customer_sites` and `reference`; each later slice
 * adds its own collection's record here with its collection.
 */

const Instant = z.iso.datetime();

/** A project the person runs or is on, without its steps (`project_milestones` carries those). */
export const SyncProjectRecord = z
  .object({
    entityId: EntityIdSchema,
    projectNo: z.string().min(1),
    salesOrderId: IdSchema,
    accountId: IdSchema,
    /** The customer's name and village, as the project screens show them to an engineer. */
    customerName: z.string().nullable(),
    village: z.string().nullable(),
    siteId: IdSchema.nullable(),
    segment: ProjectSegmentSchema,
    scheme: SubsidySchemeSchema,
    flow: ProjectFlowSchema,
    state: ProjectStateSchema,
    stateChangedAt: Instant,
    ownerId: IdSchema.nullable(),
    holdReason: z.string().nullable(),
    cancelReason: z.string().nullable(),
    assigneeIds: z.array(IdSchema),
  })
  .strict();
export type SyncProjectRecord = z.infer<typeof SyncProjectRecord>;

/** One step of a project's checklist. */
export const SyncMilestoneRecord = z
  .object({
    entityId: EntityIdSchema,
    projectId: IdSchema,
    position: z.number().int().min(1),
    key: StepKeySchema,
    /** The Executive's words, or null for a step of the default list (named from the catalogue). */
    title: z.string().nullable(),
    state: MilestoneStateSchema,
    skipReason: z.string().nullable(),
    requires: z.array(StepKeySchema),
    doneAt: Instant.nullable(),
    doneBy: IdSchema.nullable(),
  })
  .strict();
export type SyncMilestoneRecord = z.infer<typeof SyncMilestoneRecord>;

/**
 * The site of a project: the place, never an address line or a phone number
 * (`app.sync_project_sites()`).
 */
export const SyncSiteRecord = z
  .object({
    accountId: IdSchema,
    type: SiteTypeSchema,
    village: z.string().nullable(),
    tehsil: z.string().nullable(),
    district: z.string().nullable(),
    pin: z.string().nullable(),
    stateCode: z.string().nullable(),
    lat: z.number().min(-90).max(90).nullable(),
    lng: z.number().min(-180).max(180).nullable(),
    archived: z.boolean(),
  })
  .strict();
export type SyncSiteRecord = z.infer<typeof SyncSiteRecord>;

/** A company the person works in, with the segments of its pipelines. */
const SyncCompanyRecord = z
  .object({
    kind: z.literal('company'),
    entityId: EntityIdSchema,
    code: z.string().regex(/^[A-Z0-9]{2,10}$/),
    brandName: z.string().min(1),
    segments: z.array(SegmentSchema),
  })
  .strict();

/** An item of the catalogue a field engineer may pick for a job: active and kept in stock. */
const SyncItemRecord = z
  .object({
    kind: z.literal('item'),
    sku: z.string().min(1),
    name: z.string().min(1),
    category: ItemCategorySchema,
    unit: ItemUnitSchema,
    isSerialTracked: z.boolean(),
    barcode: z.string().nullable(),
    serialPattern: z.string().nullable(),
  })
  .strict();

/** The reference data the app works with: the person's companies and the items they may pick. */
export const SyncReferenceRecord = z.discriminatedUnion('kind', [
  SyncCompanyRecord,
  SyncItemRecord,
]);
export type SyncReferenceRecord = z.infer<typeof SyncReferenceRecord>;

/** Each collection's record, for the collections built so far. */
export const SYNC_RECORD_SCHEMAS = {
  projects: SyncProjectRecord,
  project_milestones: SyncMilestoneRecord,
  customer_sites: SyncSiteRecord,
  reference: SyncReferenceRecord,
} as const satisfies Partial<Record<SyncCollection, z.ZodType>>;
export type BuiltSyncCollection = keyof typeof SYNC_RECORD_SCHEMAS;

/**
 * The id of a reference record that has no UUID of its own: a company, by its number. Shaped as a
 * UUIDv7 with a zero time, which no generated id has, so it never meets a real record's.
 */
export function companyRecordId(entityId: number): string {
  return `00000000-0000-7000-8000-${entityId.toString(16).padStart(12, '0')}`;
}
