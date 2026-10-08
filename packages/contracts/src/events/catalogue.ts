import { z } from 'zod';
import { ItemCategorySchema, MoneySchema } from '../catalogue/enums';
import { DuplicateKindSchema, DuplicateReasonSchema } from '../crm/duplicates';
import { OpportunityLostReasonSchema, OpportunityNurtureReasonSchema } from '../crm/enums';
import { SizingKindSchema, SizingReasonSchema } from '../crm/sizing';
import { EntityIdSchema, IdSchema } from '../ids';
import { FilePurposeSchema } from '../api/files';
import { PdfDocumentTypeSchema } from '../api/print-documents';
import { ImportKindSchema } from '../imports/enums';

/**
 * The event catalogue (docs/03-roadmap-appendix/backend-weeks-3-5.md §4.3). Names are
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

/**
 * One type: what it means (one line, for `docs/data/events.md`), the commands that emit it
 * (checked against the command sources by `event-emitters.test.ts` in `packages/domain`), whether
 * a worker listens, and its payload.
 */
interface CatalogueEntrySpec {
  meaning: string;
  emittedBy: readonly string[];
  subscribed: boolean;
  payload: z.ZodType;
}

const eventCatalogue = {
  'org.entity.updated': {
    meaning:
      "A company's brand name, UPI id, GSTIN, state, registered address or bank account changed; `fields` names which.",
    emittedBy: ['org.entity.update'],
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
              'bankDetails',
            ]),
          )
          .min(1),
      })
      .strict(),
  },
  'crm.lead.created': {
    meaning:
      'A lead was recorded: an opportunity at the first open stage of its pipeline, for a new or an existing customer.',
    emittedBy: ['crm.lead.create', 'imports.job.commit_batch'],
    subscribed: false,
    payload: z
      .object({
        pipelineKey: Code,
        sourceCode: Code.nullable(),
        existingAccount: z.boolean(),
      })
      .strict(),
  },
  'crm.lead.attached': {
    meaning:
      "A repeat enquiry for the same segment was added to the customer's open lead, which had activity in the last 30 days, or to its lead in nurture, instead of a new lead (CRM-03). Never for a row of an import batch: the batch is listed because it runs `crm.lead.create` for its rows, which then neither attaches nor looks for duplicates.",
    emittedBy: ['crm.lead.create', 'imports.job.commit_batch'],
    subscribed: false,
    payload: z.object({ pipelineKey: Code, sourceCode: Code.nullable() }).strict(),
  },
  'crm.duplicate.found': {
    meaning:
      'Two customers, or two leads of one company, were put forward as possibly the same, with the reason and how sure the match is (CRM-03). Never for a row of an import batch, which the nightly search covers: the batch is listed because it runs `crm.lead.create` for its rows, which then looks for no duplicates.',
    emittedBy: [
      'crm.lead.create',
      'crm.duplicate.scan',
      'crm.duplicate.suggest',
      'imports.job.commit_batch',
    ],
    subscribed: false,
    payload: z
      .object({
        kind: DuplicateKindSchema,
        reason: DuplicateReasonSchema,
        confidence: z.number().int().min(1).max(100),
      })
      .strict(),
  },
  'crm.opportunity.stage_moved': {
    meaning:
      'An open lead moved to another stage of its pipeline; `handover` is true when the stage is `qualified`.',
    emittedBy: ['calls.call.log', 'crm.opportunity.stage.move'],
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
    meaning: 'A lead was given to an owner and team, locked to them for `lockHours`.',
    emittedBy: ['crm.opportunity.assign'],
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
    meaning: 'An open lead was parked in nurture with a reason code.',
    emittedBy: ['calls.call.log', 'crm.opportunity.nurture'],
    subscribed: false,
    payload: z.object({ reasonCode: OpportunityNurtureReasonSchema }).strict(),
  },
  'crm.opportunity.reopened': {
    meaning:
      "A nurtured or lost lead was opened again at its pipeline's first open stage: by a person, by a call on a nurtured lead that ends in a callback or a qualified outcome (`calls.call.log` runs `crm.opportunity.reopen`), or because a repeat enquiry joined a lead in nurture (CRM-03), which `crm.lead.create` does by running `crm.opportunity.reopen`. An import batch is listed because it runs `crm.lead.create` for its rows, but a row never joins a lead.",
    emittedBy: [
      'calls.call.log',
      'crm.lead.create',
      'crm.opportunity.reopen',
      'imports.job.commit_batch',
    ],
    subscribed: false,
    payload: z.object({ fromState: z.enum(['nurture', 'lost']), stageId: IdSchema }).strict(),
  },
  'crm.opportunity.won': {
    meaning: 'An open lead was closed as won.',
    emittedBy: ['crm.opportunity.win'],
    subscribed: false,
    payload: z.object({ stageId: IdSchema }).strict(),
  },
  'crm.opportunity.lost': {
    meaning: 'An open or nurtured lead was closed as lost with a reason code.',
    emittedBy: ['calls.call.log', 'crm.opportunity.lose'],
    subscribed: false,
    payload: z
      .object({ fromState: z.enum(['open', 'nurture']), reasonCode: OpportunityLostReasonSchema })
      .strict(),
  },
  'crm.sizing.recorded': {
    meaning:
      'A person recorded a pump or rooftop sizing of a lead, worked out on the server, with whether it is within the engineering limits and the reason codes when it is not.',
    emittedBy: ['crm.sizing.record'],
    subscribed: false,
    payload: z
      .object({
        opportunityId: IdSchema,
        kind: SizingKindSchema,
        inBounds: z.boolean(),
        reasons: z.array(SizingReasonSchema),
      })
      .strict(),
  },
  'pricing.price.changed': {
    meaning:
      'The price of an item or kit on a price list was set; the database also appends it to `price_change_log`.',
    emittedBy: ['pricing.price.set'],
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
    meaning:
      'A draft price list of a tier was made, holding a copy of the prices in force before it starts.',
    emittedBy: ['pricing.list.create'],
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
    meaning:
      "A draft price list became its tier's list from its start date; `closedListIds` are the approved lists it ends.",
    emittedBy: ['pricing.list.approve'],
    subscribed: false,
    payload: z.object({ tierCode: Code, closedListIds: z.array(IdSchema) }).strict(),
  },
  'pricing.list.archived': {
    meaning:
      'A draft or scheduled price list was withdrawn; `reopenedListId` is the list that takes back its end date.',
    emittedBy: ['pricing.list.archive'],
    subscribed: false,
    payload: z.object({ tierCode: Code, reopenedListId: IdSchema.nullable() }).strict(),
  },
  'catalogue.item.created': {
    meaning: 'An item was added to the catalogue.',
    emittedBy: ['catalogue.item.create'],
    subscribed: false,
    payload: z.object({ category: ItemCategorySchema }).strict(),
  },
  'catalogue.item.updated': {
    meaning: "An item's details or specifications changed.",
    emittedBy: ['catalogue.item.update'],
    subscribed: false,
    payload: z.object({ category: ItemCategorySchema }).strict(),
  },
  'catalogue.item.archived': {
    meaning: 'An item was withdrawn from sale.',
    emittedBy: ['catalogue.item.archive'],
    subscribed: false,
    payload: z.object({ category: ItemCategorySchema }).strict(),
  },
  'catalogue.kit.created': {
    meaning: 'A kit was added with its components.',
    emittedBy: ['catalogue.kit.create'],
    subscribed: false,
    payload: z.object({ components: z.number().int().min(1) }).strict(),
  },
  'catalogue.kit.updated': {
    meaning: "A kit's details or components changed.",
    emittedBy: ['catalogue.kit.update'],
    subscribed: false,
    payload: z.object({ components: z.number().int().min(1) }).strict(),
  },
  'catalogue.kit.archived': {
    meaning: 'A kit was withdrawn from sale.',
    emittedBy: ['catalogue.kit.archive'],
    subscribed: false,
    payload: z.object({}).strict(),
  },
  'catalogue.pump_curve.set': {
    meaning: "A pump's curve was replaced; `points` counts its points.",
    emittedBy: ['catalogue.pump_curve.set'],
    subscribed: false,
    payload: z.object({ points: z.number().int().min(2).max(30) }).strict(),
  },
  'auth.session.revoked': {
    meaning: 'One session was ended by an administrator; the row stays for the sessions screen.',
    emittedBy: ['admin.session.revoke'],
    subscribed: false,
    payload: z.object({ userId: IdSchema, reason: z.literal('admin') }).strict(),
  },
  'admin.user.invited': {
    meaning:
      'A person was invited with a role; the server action then mails the link to set a password.',
    emittedBy: ['admin.user.invite'],
    subscribed: false,
    payload: z.object({ roleId: IdSchema }).strict(),
  },
  'admin.user.suspended': {
    meaning: 'A person was suspended and signed out everywhere.',
    emittedBy: ['admin.user.suspend'],
    subscribed: false,
    payload: z.object({ revokedSessions: z.number().int().min(0) }).strict(),
  },
  'admin.user.two_factor_reset': {
    meaning: "A person's lost authenticator app was removed and they were signed out everywhere.",
    emittedBy: ['admin.user.two_factor.reset'],
    subscribed: false,
    payload: z.object({ revokedSessions: z.number().int().min(0) }).strict(),
  },
  'admin.user.reactivated': {
    meaning: 'A suspended person may sign in again.',
    emittedBy: ['admin.user.reactivate'],
    subscribed: false,
    payload: z.object({}).strict(),
  },
  'admin.user.roles_changed': {
    meaning:
      "A person's roles in the request's companies were replaced and they were signed out everywhere.",
    emittedBy: ['admin.user.role.set'],
    subscribed: false,
    payload: z.object({ roleId: IdSchema, revokedSessions: z.number().int().min(0) }).strict(),
  },
  'admin.role.permissions_changed': {
    meaning:
      "A staff role's grants were replaced and its holders signed out, apart from the caller's own session.",
    emittedBy: ['admin.role.permissions.set'],
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
    meaning: 'Every valid row of an import job is in.',
    emittedBy: ['imports.job.commit_batch'],
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
    meaning:
      'A batch of an import job failed, or its worker gave up after the last retry, and the job stopped; earlier batches stay until it is rolled back.',
    emittedBy: ['imports.job.commit_batch', 'imports.job.fail'],
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
    meaning:
      'The delivery check: its worker records when the event arrived, for Integration Health.',
    emittedBy: ['platform.probe.run'],
    subscribed: true,
    payload: z.object({ requestedAt: z.iso.datetime() }).strict(),
  },
  'imports.job.rolled_back': {
    meaning:
      'An import job was undone: its leads or customers archived, or the offices it added to the PIN code master removed.',
    emittedBy: ['imports.job.rollback'],
    subscribed: false,
    payload: z.object({ kind: ImportKindSchema, rolledBackRows: z.number().int().min(0) }).strict(),
  },
  // An upload landed and waits for its checks (`handleFileUploaded` in apps/web/src/workers/files).
  'files.file.uploaded': {
    meaning:
      'An upload landed and waits for its checks; sent again for a file whose checks stalled.',
    emittedBy: ['files.upload.complete', 'files.file.recheck'],
    subscribed: true,
    payload: z.object({ purpose: FilePurposeSchema }).strict(),
  },
  /**
   * A document to render (ADR 0009): delivered as a `PdfRenderJob` to `/api/v1/workers/pdf/render`,
   * which loads it, prints it with Chromium and stores the PDF (`apps/web/src/print`).
   */
  'print.document.requested': {
    meaning:
      'A document is to be printed: the render worker loads it, prints it with Chromium and stores the PDF.',
    emittedBy: ['print.proof.request', 'sales.quote.create', 'sales.quote.requote'],
    subscribed: true,
    payload: z
      .object({
        documentType: PdfDocumentTypeSchema,
        documentId: IdSchema,
        version: z.number().int().min(1),
      })
      .strict(),
  },
  'sales.quote.created': {
    meaning:
      'A quote was made for a lead, priced from the Price Master and taxed by the tax engine; `supersedesId` names the quote a re-quote replaced.',
    emittedBy: ['sales.quote.create', 'sales.quote.requote'],
    subscribed: false,
    payload: z
      .object({
        opportunityId: IdSchema,
        supersedesId: IdSchema.nullable(),
        lineCount: z.number().int().min(1),
      })
      .strict(),
  },
  'sales.quote.sent': {
    meaning: 'A quote with its PDF was marked as sent to the customer.',
    emittedBy: ['sales.quote.send'],
    subscribed: false,
    payload: z.object({ opportunityId: IdSchema, pdfFileId: IdSchema }).strict(),
  },
  'sales.quote.superseded': {
    meaning: 'A quote was replaced by a re-quote at current prices (`supersededById`).',
    emittedBy: ['sales.quote.requote'],
    subscribed: false,
    payload: z.object({ opportunityId: IdSchema, supersededById: IdSchema }).strict(),
  },
  'sales.quote.withdrawn': {
    meaning: 'A draft or sent quote was withdrawn, with a reason a person gave.',
    emittedBy: ['sales.quote.withdraw'],
    subscribed: false,
    payload: z.object({ opportunityId: IdSchema }).strict(),
  },
  'sales.quote.expired': {
    meaning: 'The daily job marked a quote whose validity had passed as expired.',
    emittedBy: ['sales.quote.expire'],
    subscribed: false,
    payload: z.object({ opportunityId: IdSchema }).strict(),
  },
  'sales.quote.accepted': {
    meaning:
      'A sent quote was accepted (by a signed copy staff uploaded, in Phase 1) and became the order `orderId`.',
    emittedBy: ['sales.quote.accept'],
    subscribed: false,
    payload: z
      .object({
        opportunityId: IdSchema,
        orderId: IdSchema,
        acceptedVia: z.enum(['whatsapp_reply', 'whatsapp_otp', 'signed_upload']),
      })
      .strict(),
  },
  'sales.order.created': {
    meaning:
      'A sales order was made as a draft: from an accepted quote (`quoteId`), or a dealer order without one.',
    emittedBy: ['sales.quote.accept', 'sales.order.create'],
    subscribed: false,
    payload: z
      .object({
        accountId: IdSchema,
        quoteId: IdSchema.nullable(),
        opportunityId: IdSchema.nullable(),
        lineCount: z.number().int().min(1),
      })
      .strict(),
  },
  'sales.order.confirmed': {
    meaning:
      'A sales order was confirmed after the dealer credit check; `released` says an Executive released a hold on it.',
    emittedBy: ['sales.order.confirm'],
    subscribed: false,
    payload: z
      .object({ accountId: IdSchema, opportunityId: IdSchema.nullable(), released: z.boolean() })
      .strict(),
  },
  /**
   * The dealer credit check held a confirmation (SAL-07): the order stays a draft until the
   * Executive releases it. The notice to the Executive and the order's maker is N1's to send.
   */
  'sales.order.credit_held': {
    meaning:
      'Confirming a dealer order was held by the credit check (over the limit, an invoice overdue, or no limit set); the Executive may release it.',
    emittedBy: ['sales.order.confirm'],
    subscribed: false,
    payload: z
      .object({
        accountId: IdSchema,
        createdBy: IdSchema,
        reason: z.enum(['credit_limit_exceeded', 'credit_overdue', 'credit_limit_missing']),
      })
      .strict(),
  },
  'sales.order.credit_released': {
    meaning:
      'The Executive released the credit hold of a draft order, with a reason, so its next confirmation passes the check once.',
    emittedBy: ['sales.credit.release'],
    subscribed: false,
    payload: z.object({ accountId: IdSchema }).strict(),
  },
  'sales.order.cancelled': {
    meaning:
      "A draft or confirmed sales order was cancelled with a reason; a confirmed order's commission is cancelled with it.",
    emittedBy: ['sales.order.cancel'],
    subscribed: false,
    payload: z
      .object({
        accountId: IdSchema,
        opportunityId: IdSchema.nullable(),
        fromState: z.enum(['draft', 'confirmed']),
      })
      .strict(),
  },
  'sales.commission.accrued': {
    meaning:
      "A referral partner's commission was recorded on a confirmed order by the partner's rule in force that day.",
    emittedBy: ['sales.order.confirm'],
    subscribed: false,
    payload: z
      .object({ orderId: IdSchema, partnerId: IdSchema, ruleId: IdSchema })
      .strict(),
  },
} as const satisfies Record<string, CatalogueEntrySpec>;

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

/** What the publisher sends for one event (docs/03-roadmap-appendix/backend-weeks-3-5.md §4.2). */
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

/** One catalogue entry with its payload as JSON Schema, for `docs/data/events.md` (`pnpm db:docs`). */
export interface EventCatalogueEntry {
  type: EventType;
  meaning: string;
  emittedBy: readonly string[];
  subscribed: boolean;
  payload: Record<string, unknown>;
}

/** The catalogue in its own order, each payload as JSON Schema, and the envelope a worker gets. */
export function describeEventCatalogue(): {
  version: typeof EVENT_VERSION;
  envelope: Record<string, unknown>;
  events: EventCatalogueEntry[];
} {
  return {
    version: EVENT_VERSION,
    envelope: z.toJSONSchema(DeliveredEvent),
    events: EVENT_TYPES.map((type) => ({
      type,
      meaning: eventCatalogue[type].meaning,
      emittedBy: eventCatalogue[type].emittedBy,
      subscribed: eventCatalogue[type].subscribed,
      payload: z.toJSONSchema(eventCatalogue[type].payload),
    })),
  };
}
