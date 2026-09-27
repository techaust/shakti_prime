import { z } from 'zod';
import { DeliveredEvent, EventTypeSchema } from '../events/catalogue';
import { EntityIdSchema, IdSchema } from '../ids';
import { SCRIPT_LANGUAGES } from '../templates/index';
import { MessageRequested, MessagingRefusalSchema } from './messaging';

/**
 * Bodies and answers of the QStash workers under `/api/v1/workers/*` (docs/API.md §3.6,
 * docs/design/backend-weeks-3-5.md §4.4). Every call carries `Upstash-Signature`, checked with the
 * current and next signing keys before the body is read. The worker then checks `eventId` in Redis
 * (`evt:{id}`, kept 7 days): an id it has already handled answers `duplicate` and runs nothing;
 * otherwise it runs the command as its principal (a named agent principal or `system:workers`,
 * never with a cost permission), records the id and answers `done`. A failure it can recover from
 * answers a 5xx, and QStash delivers the same body again.
 *
 * Bodies carry ids, codes and counts only, like the outbox events they come from: a worker reads
 * names, phones and text from the records themselves, under its own principal.
 * `/workers/outbox/publish` is in `workers.ts`.
 */

const Count = z.number().int().min(0);

/** A code such as a notification type or a document kind: lowercase words joined by `_` or `.`. */
const CodeSchema = z.string().regex(/^[a-z][a-z0-9_.]{0,63}$/);

/** `done`: the worker acted. `duplicate`: the event id was already recorded and nothing ran. */
export const WorkerOutcomeSchema = z.enum(['done', 'duplicate']);
export type WorkerOutcome = z.infer<typeof WorkerOutcomeSchema>;

/** The answer to a redelivered body: the id, and nothing else ran. */
const Duplicate = z.object({ eventId: IdSchema, outcome: z.literal('duplicate') }).strict();

/** A worker's answer: `duplicate`, or `done` with what that worker reports. */
function workerResult<T extends z.ZodRawShape>(done: T) {
  return z.union([
    Duplicate,
    z.object({ eventId: IdSchema, outcome: z.literal('done'), ...done }).strict(),
  ]);
}

/** The plain answer of a worker with nothing more to report. */
export const WorkerAck = z.object({ eventId: IdSchema, outcome: WorkerOutcomeSchema }).strict();
export type WorkerAck = z.infer<typeof WorkerAck>;

// --- /workers/outbox/:type -------------------------------------------------------------------

/**
 * `POST /workers/outbox/:type`: one event from the outbox, as the publisher sends it to the queue
 * group `evt-<type>` (`DeliveredEvent`); `:type` equals the body's `type`. The event's `id` is the
 * id the worker records.
 */
export const OutboxEventParams = z.object({ type: EventTypeSchema }).strict();
export type OutboxEventParams = z.infer<typeof OutboxEventParams>;

export const OutboxEventDelivery = DeliveredEvent;
export type OutboxEventDelivery = z.infer<typeof OutboxEventDelivery>;

/** `eventId` is the delivered event's `id`. */
export const OutboxEventResult = WorkerAck;
export type OutboxEventResult = z.infer<typeof OutboxEventResult>;

// --- /workers/messaging/send -----------------------------------------------------------------

/** `POST /workers/messaging/send`: one `message.requested` (docs/API.md §6) to check and send. */
export const MessagingSendJob = z
  .object({
    eventId: IdSchema,
    entityId: EntityIdSchema,
    message: MessageRequested,
  })
  .strict();
export type MessagingSendJob = z.infer<typeof MessagingSendJob>;

export const MessagingSendResult = z.union([
  Duplicate,
  z
    .object({
      eventId: IdSchema,
      outcome: z.literal('done'),
      status: z.literal('sent'),
      /** Meta's message id (`wamid.…`), stored as `whatsapp_messages.provider_message_id`. */
      providerMessageId: z.string().min(1).max(256),
    })
    .strict(),
  z
    .object({
      eventId: IdSchema,
      outcome: z.literal('done'),
      status: z.literal('refused'),
      refusal: MessagingRefusalSchema,
    })
    .strict(),
]);
export type MessagingSendResult = z.infer<typeof MessagingSendResult>;

// --- /workers/files/scan and /workers/files/mask ---------------------------------------------

/** `POST /workers/files/scan`: the malware scan of an upload marked complete (`files.status`). */
export const FileScanJob = z.object({ eventId: IdSchema, fileId: IdSchema }).strict();
export type FileScanJob = z.infer<typeof FileScanJob>;

/** `clean` queues the masking step; `infected` and `unreadable` reject the file. */
export const FileScanVerdictSchema = z.enum(['clean', 'infected', 'unreadable']);
export type FileScanVerdict = z.infer<typeof FileScanVerdictSchema>;

export const FileScanResult = workerResult({ fileId: IdSchema, verdict: FileScanVerdictSchema });
export type FileScanResult = z.infer<typeof FileScanResult>;

/**
 * `POST /workers/files/mask`: OCR masking of a scanned file before the kept copy is stored and
 * before any classifier sees it (docs/spikes/ocr.md). `expect` names what the upload slot holds;
 * a WhatsApp upload sends none.
 */
export const FileMaskJob = z
  .object({
    eventId: IdSchema,
    fileId: IdSchema,
    expect: z
      .array(z.enum(['aadhaar', 'bank_account']))
      .max(2)
      .default([]),
  })
  .strict();
export type FileMaskJob = z.infer<typeof FileMaskJob>;

/**
 * `masked`: numbers were covered and the masked copy kept. `clean`: no number found, the copy kept
 * as it is. `needs_review`: the photo reads like an identity document but no number was found, so
 * nothing is kept and a person looks at it. `rejected`: the file cannot be read.
 */
export const FileMaskStatusSchema = z.enum(['masked', 'clean', 'needs_review', 'rejected']);
export type FileMaskStatus = z.infer<typeof FileMaskStatusSchema>;

export const FileMaskResult = workerResult({
  fileId: IdSchema,
  status: FileMaskStatusSchema,
  regionsMasked: Count,
});
export type FileMaskResult = z.infer<typeof FileMaskResult>;

// --- /workers/pdf/render ---------------------------------------------------------------------

/** Documents rendered to A4 PDFs from their HTML templates (ADR 0009). */
export const PDF_DOCUMENT_TYPES = [
  'quote',
  'proforma',
  'delivery_challan',
  'handover_kit',
] as const;
export const PdfDocumentTypeSchema = z.enum(PDF_DOCUMENT_TYPES);

/** Label stock sizes in millimetres, one label per page (docs/spikes/print.md). */
export const LabelSizeSchema = z.enum(['50x25', '100x50']);
export const LabelKindSchema = z.enum(['serial', 'bin', 'package']);

/**
 * `POST /workers/pdf/render`: one document at a given version, or one sheet of labels. The template
 * reads the document's DTO; money and tax arrive computed and are only formatted.
 */
export const PdfRenderJob = z
  .object({
    eventId: IdSchema,
    entityId: EntityIdSchema,
    target: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('document'),
          documentType: PdfDocumentTypeSchema,
          documentId: IdSchema,
          version: z.number().int().min(1),
        })
        .strict(),
      z
        .object({
          kind: z.literal('labels'),
          labelKind: LabelKindSchema,
          size: LabelSizeSchema,
          ids: z.array(IdSchema).min(1).max(500),
        })
        .strict(),
    ]),
  })
  .strict();
export type PdfRenderJob = z.infer<typeof PdfRenderJob>;

export const PdfRenderResult = workerResult({
  fileId: IdSchema,
  pages: z.number().int().min(1),
  bytes: z.number().int().min(1),
});
export type PdfRenderResult = z.infer<typeof PdfRenderResult>;

// --- /workers/agents/:agent ------------------------------------------------------------------

/**
 * The six agents (docs/BLUEPRINT.md §9.3), named as their principals' roles without `agent:`;
 * `worker-jobs.test.ts` holds the two lists together.
 */
export const AGENT_NAMES = [
  'triage',
  'concierge',
  'copilot',
  'sizing',
  'orchestrator',
  'chief',
] as const;
export const AgentNameSchema = z.enum(AGENT_NAMES);
export type AgentName = z.infer<typeof AgentNameSchema>;

/**
 * `POST /workers/agents/:agent`: the event that wakes an agent, as the outbox delivers it. The run
 * uses the agent's own principal and its autonomy level per action type.
 */
export const AgentRunParams = z.object({ agent: AgentNameSchema }).strict();
export type AgentRunParams = z.infer<typeof AgentRunParams>;

export const AgentRunJob = DeliveredEvent;
export type AgentRunJob = z.infer<typeof AgentRunJob>;

/**
 * `suggested` actions wait in the Agent Inbox, `awaiting_approval` ones for one tap, `applied`
 * ones ran as commands. `stopped` names the switch that ended the run early, if any.
 */
export const AgentRunResult = workerResult({
  runId: IdSchema,
  suggested: Count,
  awaitingApproval: Count,
  applied: Count,
  stopped: z.enum(['kill_switch', 'spend_cap']).nullable(),
});
export type AgentRunResult = z.infer<typeof AgentRunResult>;

// --- /workers/stt/transcribe -----------------------------------------------------------------

/** `POST /workers/stt/transcribe`: a call recording or a voice session's audio to transcribe. */
export const SttTranscribeJob = z
  .object({
    eventId: IdSchema,
    entityId: EntityIdSchema,
    source: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('call'), callId: IdSchema }).strict(),
      z.object({ kind: z.literal('voice_session'), voiceSessionId: IdSchema }).strict(),
    ]),
    audioFileId: IdSchema,
    /** The customer's language for calls (`contacts.preferred_language`). */
    languageHint: z.enum(SCRIPT_LANGUAGES),
  })
  .strict();
export type SttTranscribeJob = z.infer<typeof SttTranscribeJob>;

export const SttTranscribeResult = workerResult({
  transcriptFileId: IdSchema,
  audioSeconds: Count,
});
export type SttTranscribeResult = z.infer<typeof SttTranscribeResult>;

// --- /workers/embeddings/index ---------------------------------------------------------------

/** Who may retrieve a vault file's chunks (docs/DATABASE.md §6.9). */
export const KnowledgeSensitivitySchema = z.enum(['exec_only', 'management', 'staff_ai_ok']);
export type KnowledgeSensitivity = z.infer<typeof KnowledgeSensitivitySchema>;

/**
 * `POST /workers/embeddings/index`: chunk and embed one vault file. The chunks take the file's
 * entity (null for the whole group) and sensitivity, which the retrieval policies filter on.
 */
export const EmbeddingsIndexJob = z
  .object({
    eventId: IdSchema,
    knowledgeFileId: IdSchema,
    entityId: EntityIdSchema.nullable(),
    sensitivity: KnowledgeSensitivitySchema,
  })
  .strict();
export type EmbeddingsIndexJob = z.infer<typeof EmbeddingsIndexJob>;

/** `replaced` counts the file's earlier chunks removed by this run. */
export const EmbeddingsIndexResult = workerResult({
  knowledgeFileId: IdSchema,
  chunks: Count,
  replaced: Count,
});
export type EmbeddingsIndexResult = z.infer<typeof EmbeddingsIndexResult>;

// --- /workers/notify -------------------------------------------------------------------------

/**
 * `POST /workers/notify`: one notification for up to 500 people, written to `notifications` and
 * pushed by browser push and FCM under each person's preferences and quiet hours (BLUEPRINT
 * §8.11). The words come from the catalogue by `type`; the body names the record, never its text.
 */
export const NotifyJob = z
  .object({
    eventId: IdSchema,
    entityId: EntityIdSchema,
    type: CodeSchema,
    recipientIds: z.array(IdSchema).min(1).max(500),
    subject: z.object({ type: CodeSchema, id: IdSchema }).strict(),
  })
  .strict();
export type NotifyJob = z.infer<typeof NotifyJob>;

/** `heldForQuietHours` counts pushes kept until the person's quiet hours end. */
export const NotifyResult = workerResult({
  created: Count,
  pushed: Count,
  heldForQuietHours: Count,
});
export type NotifyResult = z.infer<typeof NotifyResult>;
