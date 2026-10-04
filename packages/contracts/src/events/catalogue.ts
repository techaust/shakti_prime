import { z } from 'zod';
import { ItemCategorySchema, MoneySchema } from '../catalogue/enums';
import { OpportunityLostReasonSchema, OpportunityNurtureReasonSchema } from '../crm/enums';
import { EntityIdSchema, IdSchema } from '../ids';
import { FilePurposeSchema } from '../api/files';
import { ImportKindSchema } from '../imports/enums';

/**
 * The event catalogue (docs/design/backend-weeks-3-5.md §4.3). Names are
 * `<aggregate>.<verb_past>`; every stored payload carries `v`, the version of its shape.
 *
 * Payloads leave the database for the queue, so they carry ids, codes, counts and times only:
 * never a name, phone, email or free text. A consumer reads anything else from the aggregate itself.
 *
 * `subscribed` says whether any worker listens to the type yet. The publisher marks an event
 * nobody listens to as delivered without sending it, because a message to a queue group with no
 * endpoint fails; the first worker for a type switches it on.
 */
export const EVENT_VERSION = 1;

const Code = z.string().trim().min(1).max(40);

const eventCatalogue = {
  'org.entity.updated': {
    subscribed: false,
    payload: z
      .object({
        fields: z
          .array(
            z.enum([
              'brandName',
              'upiId',
              'gstin',
              'stateCode',
              'addressLine1',
              'addressLine2',
              'city',
              'pin',
            ]),
          )
          .min(1),
      })
      .strict(),
  },
  'crm.lead.created': {
    subscribed: false,
    payload: z
      .object({
        pipelineKey: Code,
        sourceCode: Code.nullable(),
        existingAccount: z.boolean(),
      })
      .strict(),
  },
  'crm.opportunity.stage_moved': {
    subscribed: false,
    payload: z
      .object({
        fromStageId: IdSchema,
        toStageId: IdSchema,
        toStageKey: Code,
        /** The target stage is `qualified`: the handover worker assigns a Lead Converter. */
        handover: z.boolean(),
      })
      .strict(),
  },
  'crm.opportunity.assigned': {
    subscribed: false,
    payload: z
      .object({
        ownerId: IdSchema,
        teamId: IdSchema.nullable(),
        lockHours: z.number().int().min(1).max(720),
      })
      .strict(),
  },
  'crm.opportunity.nurtured': {
    subscribed: false,
    payload: z.object({ reasonCode: OpportunityNurtureReasonSchema }).strict(),
  },
  'crm.opportunity.reopened': {
    subscribed: false,
    payload: z.object({ fromState: z.enum(['nurture', 'lost']), stageId: IdSchema }).strict(),
  },
  'crm.opportunity.won': {
    subscribed: false,
    payload: z.object({ stageId: IdSchema }).strict(),
  },
  'crm.opportunity.lost': {
    subscribed: false,
    payload: z
      .object({ fromState: z.enum(['open', 'nurture']), reasonCode: OpportunityLostReasonSchema })
      .strict(),
  },
  'pricing.price.changed': {
    subscribed: false,
    payload: z
      .object({
        priceListId: IdSchema,
        itemId: IdSchema.nullable(),
        kitId: IdSchema.nullable(),
        oldPrice: MoneySchema.nullable(),
        newPrice: MoneySchema,
      })
      .strict(),
  },
  'pricing.list.created': {
    subscribed: false,
    payload: z
      .object({
        tierCode: Code,
        copiedFromId: IdSchema.nullable(),
        prices: z.number().int().min(0),
      })
      .strict(),
  },
  'pricing.list.approved': {
    subscribed: false,
    payload: z.object({ tierCode: Code, closedListIds: z.array(IdSchema) }).strict(),
  },
  'pricing.list.archived': {
    subscribed: false,
    payload: z.object({ tierCode: Code, reopenedListId: IdSchema.nullable() }).strict(),
  },
  'catalogue.item.created': {
    subscribed: false,
    payload: z.object({ category: ItemCategorySchema }).strict(),
  },
  'catalogue.item.updated': {
    subscribed: false,
    payload: z.object({ category: ItemCategorySchema }).strict(),
  },
  'catalogue.item.archived': {
    subscribed: false,
    payload: z.object({ category: ItemCategorySchema }).strict(),
  },
  'catalogue.kit.created': {
    subscribed: false,
    payload: z.object({ components: z.number().int().min(1) }).strict(),
  },
  'catalogue.kit.updated': {
    subscribed: false,
    payload: z.object({ components: z.number().int().min(1) }).strict(),
  },
  'catalogue.kit.archived': {
    subscribed: false,
    payload: z.object({}).strict(),
  },
  'catalogue.pump_curve.set': {
    subscribed: false,
    payload: z.object({ points: z.number().int().min(2).max(30) }).strict(),
  },
  'auth.session.revoked': {
    subscribed: false,
    payload: z.object({ userId: IdSchema, reason: z.literal('admin') }).strict(),
  },
  'admin.user.invited': {
    subscribed: false,
    payload: z.object({ roleId: IdSchema }).strict(),
  },
  'admin.user.suspended': {
    subscribed: false,
    payload: z.object({ revokedSessions: z.number().int().min(0) }).strict(),
  },
  'admin.user.two_factor_reset': {
    subscribed: false,
    payload: z.object({ revokedSessions: z.number().int().min(0) }).strict(),
  },
  'admin.user.reactivated': {
    subscribed: false,
    payload: z.object({}).strict(),
  },
  'admin.user.roles_changed': {
    subscribed: false,
    payload: z.object({ roleId: IdSchema, revokedSessions: z.number().int().min(0) }).strict(),
  },
  'admin.role.permissions_changed': {
    subscribed: false,
    payload: z
      .object({
        roleId: IdSchema,
        grantCount: z.number().int().min(0),
        added: z.number().int().min(0),
        removed: z.number().int().min(0),
        rescoped: z.number().int().min(0),
        holders: z.number().int().min(0),
        revokedSessions: z.number().int().min(0),
      })
      .strict(),
  },
  'imports.job.committed': {
    subscribed: false,
    payload: z
      .object({
        kind: ImportKindSchema,
        committedRows: z.number().int().min(0),
        batches: z.number().int().min(1),
      })
      .strict(),
  },
  'imports.job.failed': {
    subscribed: false,
    payload: z
      .object({
        kind: ImportKindSchema,
        committedRows: z.number().int().min(0),
        failedBatch: z.number().int().min(1),
      })
      .strict(),
  },
  /**
   * The delivery check (`platform.probe.run`): its worker records when the event arrived, which
   * the Integration Health page compares with `requestedAt`, the moment the command ran.
   */
  'platform.probe.requested': {
    subscribed: true,
    payload: z.object({ requestedAt: z.iso.datetime() }).strict(),
  },
  'imports.job.rolled_back': {
    subscribed: false,
    payload: z.object({ kind: ImportKindSchema, rolledBackRows: z.number().int().min(0) }).strict(),
  },
  // An upload landed and waits for its checks (`handleFileUploaded` in apps/web/src/workers/files).
  'files.file.uploaded': {
    subscribed: true,
    payload: z.object({ purpose: FilePurposeSchema }).strict(),
  },
} as const satisfies Record<string, { subscribed: boolean; payload: z.ZodType }>;

export type EventType = keyof typeof eventCatalogue;
export const EVENT_TYPES = Object.keys(eventCatalogue) as EventType[];
export const EventTypeSchema = z.enum(EVENT_TYPES as [EventType, ...EventType[]]);

export type EventPayload<T extends EventType> = z.infer<(typeof eventCatalogue)[T]['payload']>;

/** The payload as stored in `outbox_events.payload_json` and delivered to workers. */
export type StoredEventPayload = Record<string, unknown> & { v: typeof EVENT_VERSION };

export function isEventType(type: string): type is EventType {
  return Object.hasOwn(eventCatalogue, type);
}

export function isSubscribed(type: string): boolean {
  return isEventType(type) && eventCatalogue[type].subscribed;
}

export type ParsedEvent =
  | { ok: true; payload: StoredEventPayload }
  | { ok: false; problem: 'unknown_type' | 'bad_payload'; issues: string[] };

/** Checks a payload against its type and adds the version; used by `ctx.emit()`. */
export function parseEventPayload(type: string, payload: unknown): ParsedEvent {
  if (!isEventType(type)) return { ok: false, problem: 'unknown_type', issues: [] };
  const parsed = eventCatalogue[type].payload.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      problem: 'bad_payload',
      issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  }
  return { ok: true, payload: { ...(parsed.data as Record<string, unknown>), v: EVENT_VERSION } };
}

/** What the publisher sends for one event (docs/design/backend-weeks-3-5.md §4.2). */
export const DeliveredEvent = z
  .object({
    id: IdSchema,
    sequence: z.string().regex(/^\d+$/),
    type: EventTypeSchema,
    entityId: EntityIdSchema,
    aggregateType: z.string().min(1).max(64),
    aggregateId: z.string().min(1).max(64),
    payload: z.record(z.string(), z.unknown()).and(z.object({ v: z.literal(EVENT_VERSION) })),
  })
  .strict();
export type DeliveredEvent = z.infer<typeof DeliveredEvent>;
