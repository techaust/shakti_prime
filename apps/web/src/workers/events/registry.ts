import type { DeliveredEvent, EventType, Principal } from '@shakti/contracts';
import {
  bumpPlaybookVersion,
  checkPlaybook,
  indexKnowledgeFile,
  type KeyValue,
} from '@shakti/domain';
import { hostedRuntime } from '../../auth/deps';
import { aiProvider } from '../../integrations/ai';
import { requireFileStore } from '../../files/uploads';
import { handleFileUploaded } from '../files/handle-file-uploaded';
import { indexJobOf } from '../knowledge/job';
import { discardVaultMasker, maskingConfigured, vaultMasker } from '../ocr/vault-masker';
import { handleHandoverEvent } from '../handover/handover-event';
import { handleProjectDraft } from '../projects/draft-event';
import { handleOrderCancelled } from '../projects/order-cancelled-event';
import { handleNoticeEvent } from '../notify/notify-event';
import { handleTriageEvent } from '../triage/triage-event';
import { handleBriefEvent, handleCallSummaryEvent } from '../copilot/copilot-event';
import { handleConciergeEvent } from '../concierge/concierge-event';
import { labelsJobOf, renderJobOf } from '../pdf/job';
import { sendJobOf } from '../messaging/job';
import { whatsappButtonSecret } from '../messaging/button-secret';
import { recordProbeArrival } from './probe';

/** What a handler is given: the system principal for the event's company and the shared store. */
export interface EventHandlerContext {
  /** `system:workers`, scoped to the event's company; commands run as it (`executeCommand`). */
  principal: Principal;
  keyValue: KeyValue;
  requestId: string;
  now: Date;
  /** When the delivery began, on `performance.now()`'s clock (the route's start when routed). */
  startedAt: number;
}

/**
 * Handles one delivered event. A handler that changes data does it through `executeCommand` as
 * `ctx.principal`; a `DomainError` it throws is answered with its code, and every code but
 * `validation_failed`, `forbidden` and `not_found` is delivered again.
 */
export type EventHandler = (event: DeliveredEvent, ctx: EventHandlerContext) => Promise<void>;

/**
 * How a worker treats the order of its events (docs/03-roadmap-appendix/phase1.md §5.2). QStash keeps no order
 * between messages:
 * - `every` (the default) handles every event exactly once by its id, whatever arrives first, so
 *   a failed older event's retry still runs after a newer one succeeded;
 * - `latest-only` is for a worker that needs only an aggregate's latest state: it skips an event
 *   no newer than the last one it handled for that aggregate (`seq:{type}:{aggregateType}:{id}`).
 */
export type EventOrdering = 'every' | 'latest-only';

export interface EventWorker {
  handle: EventHandler;
  ordering?: EventOrdering;
}

/**
 * The worker of every subscribed event type. A type is `subscribed: true` in the event catalogue
 * exactly when it has a worker here, which a test checks, and its QStash URL group `evt-<type>`
 * points at `/api/v1/workers/outbox/<type>`.
 */
export const EVENT_WORKERS: Partial<Record<EventType, EventWorker>> = {
  'platform.probe.requested': {
    handle: (event, ctx) => recordProbeArrival(event, ctx.keyValue, ctx.now),
  },
  // The checks of an upload (docs/04-architecture.md §9). Every event is handled: a re-drive from
  // Integration health is a new event for the same file, and the checks start from its status.
  'files.file.uploaded': {
    ordering: 'every',
    handle: async (event, ctx) => {
      await handleFileUploaded(event, {
        // No store on a hosted runtime without S3: `integration_unavailable`, delivered again.
        store: requireFileStore(),
        principal: ctx.principal,
        hosted: hostedRuntime(),
        // Without the OCR model a vault photo or PDF is refused at once, not delivered again.
        ...(maskingConfigured() ? { masker: vaultMasker, discardMasker: discardVaultMasker } : {}),
        keyValue: ctx.keyValue,
        requestId: ctx.requestId,
        startedAt: ctx.startedAt,
      });
    },
  },
  // A document to print (ADR 0009). Hosted, the publisher sends this type to the render route
  // as a `PdfRenderJob` instead (`EVENT_JOB_ROUTES` in ../qstash.ts); without a queue it is
  // rendered here, in the process that committed it. Each job's file id makes a repeat harmless.
  'print.document.requested': {
    ordering: 'every',
    handle: async (event, ctx) => {
      // Loaded on first use, so Chromium's driver stays out of every other worker's start.
      const { renderPdfJob } = await import('../pdf/render-job');
      const { renderDeps } = await import('../pdf/deps');
      await renderPdfJob(renderJobOf(event), renderDeps(ctx.principal, ctx.requestId));
    },
  },
  // Q1: a sheet of QR labels, rendered as a document is: hosted, the publisher sends it to the
  // render route (`EVENT_JOB_ROUTES`); without a queue it is printed here. The sheet's id is its
  // file's, so a repeat is harmless.
  'print.labels.requested': {
    ordering: 'every',
    handle: async (event, ctx) => {
      const { renderPdfJob } = await import('../pdf/render-job');
      const { renderDeps } = await import('../pdf/deps');
      await renderPdfJob(labelsJobOf(event), renderDeps(ctx.principal, ctx.requestId));
    },
  },
  // A vault file to read and index (docs/03-roadmap-appendix/phase1.md §8.4). Hosted, the publisher sends this
  // type to the index route as an `EmbeddingsIndexJob` (`EVENT_JOB_ROUTES`); without a queue it is
  // indexed here. A file no longer waiting is answered as it stands, so a repeat is harmless.
  'knowledge.file.index_requested': {
    ordering: 'every',
    handle: async (event, ctx) => {
      // Loaded on first use, so the Word reader stays out of every other worker's start.
      const { indexDeps } = await import('../knowledge/index-deps');
      await indexKnowledgeFile(
        indexJobOf(event),
        indexDeps(ctx.principal, ctx.requestId, ctx.keyValue),
      );
    },
  },
  // A Playbook directive changed (docs/03-roadmap-appendix/phase2.md §5.4): a new version id, so
  // the agents and Ask read the approved directives again, then the conflict check of the draft
  // whose wording is new, or of the drafts an approval made stale. A repeat bumps the version once
  // more and checks only what is still unchecked.
  'knowledge.playbook.changed': {
    ordering: 'every',
    handle: async (event, ctx) => {
      await bumpPlaybookVersion(ctx.keyValue);
      await checkPlaybook(event, {
        principal: ctx.principal,
        provider: aiProvider(),
        requestId: ctx.requestId,
        hosted: hostedRuntime(),
      });
    },
  },
  // A lead that reached Qualified goes to a Lead Converter, or to the Sales Team Lead when none
  // qualifies (docs/03-roadmap-appendix/phase1.md §8.2). Handled in this route's own process, within
  // seconds of the event; an event whose lead did not reach Qualified is left alone.
  'crm.opportunity.stage_moved': {
    ordering: 'every',
    handle: async (event, ctx) => {
      await handleHandoverEvent(event, ctx);
    },
  },
  // The Triage agent on each new lead (docs/03-roadmap-appendix/phase1.md §9, A1): in Shadow it
  // records what it would propose and changes nothing. A repeat records nothing twice.
  // The Caller Co-pilot (A2, docs/03-roadmap-appendix/phase2.md §7.3): a brief a person asked for,
  // and the summary of a recorded call. Each records nothing twice for a repeat.
  'agents.brief.requested': {
    ordering: 'every',
    handle: async (event, ctx) => {
      await handleBriefEvent(event, ctx);
    },
  },
  'calls.dial.completed': {
    ordering: 'every',
    handle: async (event, ctx) => {
      await handleCallSummaryEvent(event, ctx);
    },
  },
  'crm.lead.created': {
    ordering: 'every',
    handle: async (event, ctx) => {
      await handleTriageEvent(event, ctx);
    },
  },
  // A queued WhatsApp message (docs/06-api.md §6). Hosted, the publisher sends this type to the
  // messaging route as a `MessagingSendJob` (`EVENT_JOB_ROUTES`); without a queue it is checked and
  // sent here. A message is taken once, so a repeat never sends it twice.
  'messaging.message.requested': {
    ordering: 'every',
    handle: async (event, ctx) => {
      const { sendQueuedMessage } = await import('../messaging/send');
      const { sendDeps } = await import('../messaging/send-deps');
      await sendQueuedMessage(
        sendJobOf(event),
        sendDeps(ctx.principal, ctx.keyValue, ctx.requestId, hostedRuntime()),
      );
    },
  },
  // The WhatsApp Concierge (A3, docs/03-roadmap-appendix/phase2.md §7.2) on each customer message
  // of a chat the assistant answers: in Shadow it records the reply it would draft and sends
  // nothing. A message the platform answers itself is never the Concierge's. A repeat records
  // nothing twice.
  'messaging.message.received': {
    ordering: 'every',
    handle: async (event, ctx) => {
      await handleConciergeEvent(event, ctx);
    },
  },
  // A quote sent by WhatsApp and an order confirmed go to the customer as their milestones
  // (docs/03-roadmap-appendix/phase2.md §7.1), once per subject however often delivered.
  'sales.quote.sent': {
    ordering: 'every',
    handle: async (event, ctx) => {
      const { handleQuoteSent } = await import('../messaging/milestones');
      await handleQuoteSent(event, ctx);
    },
  },
  // J1: a confirmed order that needs installing also gets its project (docs/03-roadmap-appendix/
  // phase4.md §6.1), drafted first, since it waits on no outside service; once per order.
  'sales.order.confirmed': {
    ordering: 'every',
    handle: async (event, ctx) => {
      await handleProjectDraft(event, ctx);
      // The customer's message, and (FN1) the order's payment milestones: each runs whatever the
      // other answered, and both are safe to repeat, so a failure of either is delivered again.
      const { handleOrderConfirmed } = await import('../messaging/milestones');
      const { handleOrderConfirmedMilestones } = await import('../finance/plan-milestones');
      const message = await Promise.allSettled([handleOrderConfirmed(event, ctx)]);
      await handleOrderConfirmedMilestones(event, ctx);
      if (message[0].status === 'rejected') throw message[0].reason;
    },
  },
  // J1: a cancelled order's project is cancelled while none of its steps is done, else kept and
  // its Project Manager told (`projects.project.order_cancelled`, a notice). FN1: its live proforma
  // and waiting payments are cancelled with it. Each runs whatever the other answered, and both are
  // safe to repeat, so a failure of either is delivered again.
  'sales.order.cancelled': {
    ordering: 'every',
    handle: async (event, ctx) => {
      const { handleOrderCancelledFinance } = await import('../finance/order-followups');
      const project = await Promise.allSettled([handleOrderCancelled(event, ctx)]);
      await handleOrderCancelledFinance(event, ctx);
      if (project[0].status === 'rejected') throw project[0].reason;
    },
  },
  // A quote's Accept or Talk to us pressed on WhatsApp (§7.1): checked and answered by the
  // platform; one acceptance makes one order however often it arrives.
  'messaging.button.pressed': {
    ordering: 'every',
    handle: async (event, ctx) => {
      const { handleQuotePress } = await import('../messaging/quote-press');
      await handleQuotePress(event, {
        principal: ctx.principal,
        keyValue: ctx.keyValue,
        requestId: ctx.requestId,
        now: () => new Date(),
        buttonSecret: whatsappButtonSecret(),
      });
    },
  },
  // The notices people act on (docs/03-roadmap-appendix/phase1.md §8.1). Hosted, the publisher sends these
  // types to the notify route as a `NotifyJob` (`EVENT_JOB_ROUTES`); without a queue they are
  // handled here. Each notice is one per person and reason, so a repeat writes nothing new.
  // An assigned lead also gets the Caller Co-pilot's brief (docs/03-roadmap-appendix/phase2.md
  // §7.3), after its notices; so this type runs on its own event route, whose minute holds both.
  'crm.opportunity.assigned': {
    ordering: 'every',
    handle: async (event, ctx) => {
      await notify(event, ctx);
      await handleBriefEvent(event, ctx);
    },
  },
  'crm.duplicate.found': { ordering: 'every', handle: notify },
  'crm.enquiry.routed': { ordering: 'every', handle: notify },
  'sales.order.credit_held': { ordering: 'every', handle: notify },
  // FN1: a confirmed order's payments the platform could not plan, told to Accounts.
  'finance.milestones.plan_failed': { ordering: 'every', handle: notify },
  'sales.quote.accepted': { ordering: 'every', handle: notify },
  // A missed call's callback, told to the lead's owner (docs/03-roadmap-appendix/phase2.md §7.4).
  'calls.missed.recorded': { ordering: 'every', handle: notify },
  // p2-fixes (I1 re-check N2): an enquiry that joined a nurtured lead, told to its owner.
  'crm.lead.attached': { ordering: 'every', handle: notify },
  // J1: a project kept for its cancelled order, told to its owner or the Project Managers.
  'projects.project.order_cancelled': { ordering: 'every', handle: notify },
  // J2: a loan turned down, told to the owner of the order's lead or customer.
  'crm.loan.rejected': { ordering: 'every', handle: notify },
  // FN1 with J2: a loan's move lets the order's payments it held fall due (review finding 4).
  'crm.loan.sanctioned': { ordering: 'every', handle: loanMoved },
  'crm.loan.disbursed': { ordering: 'every', handle: loanMoved },
  'crm.loan.gates_released': { ordering: 'every', handle: loanMoved },
};

/** A customer loan's move: the order's payments its loan no longer holds fall due (FN1). */
async function loanMoved(event: DeliveredEvent, ctx: EventHandlerContext): Promise<void> {
  const { handleOrderLoanMoved } = await import('../finance/order-followups');
  await handleOrderLoanMoved(event, ctx);
}

/** Every notifying event is handled the same way: its notices, then their pushes. */
async function notify(event: DeliveredEvent, ctx: EventHandlerContext): Promise<void> {
  await handleNoticeEvent(event, ctx);
}

/** The worker of a type, or undefined for a type no worker handles. */
export function workerFor(type: string): EventWorker | undefined {
  return Object.hasOwn(EVENT_WORKERS, type) ? EVENT_WORKERS[type as EventType] : undefined;
}
