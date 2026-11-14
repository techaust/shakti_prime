import {
  DomainError,
  type WhatsAppInboundMessage,
  type WhatsAppStatus,
  type WhatsAppWebhook,
} from '@shakti/contracts';
import {
  attachWhatsAppMedia,
  executeCommand,
  executeQuery,
  matchKeyword,
  matchWhatsAppThread,
  queueWhatsAppMessage,
  recordInboundWhatsApp,
  recordQuality,
  recordWhatsAppHandOff,
  recordWhatsAppOptOut,
  recordWhatsAppStatus,
  recordWhatsAppTemplateStatus,
  uploadKey,
  whatsappChannelEntity,
  whatsappTemplateEntities,
  type FileStore,
  type KeyValue,
  type Logger,
  WORKSHOP_DEFAULTS,
} from '@shakti/domain';
import { createHash } from 'node:crypto';
import type { DownloadedMedia } from '../../integrations/whatsapp/media';
import { logger as appLogger } from '../../log';
import { systemWorkersPrincipal } from '../events/system-principal';
import type { WebhookHandled, WebhookHandlerContext } from './registry';

/**
 * The lead intake's call for a number no customer of the company holds (docs/03-roadmap-appendix/
 * phase2.md §6.1): I1's `crm.lead.ingest` input as WhatsApp fills it (channel `whatsapp`, the
 * pipeline by key since WhatsApp has no ingest source, the message id as the external id, the
 * click-to-WhatsApp `referral` as the attribution, never a consent) and the idempotency key it runs
 * with, `whatsapp:<externalId>`, so a repeated message makes no second lead. The port answers the
 * customer the intake recorded, or null when it made no lead; the lead wires it to the command
 * once I1 has merged, which is then a one-line change in `whatsapp-deps.ts`.
 */
export interface WhatsAppIngestCall {
  input: {
    entityId: number;
    channel: 'whatsapp';
    pipelineKey: string;
    externalId: string;
    contact: { name: string; phone: string };
    attribution?: {
      ctwaClid?: string;
      referralSourceId?: string;
      referralSourceType?: string;
      sourceUrl?: string;
    };
  };
  idempotencyKey: string;
}
export type IngestLeadPort = (call: WhatsAppIngestCall) => Promise<{ accountId: string } | null>;

/** No intake wired yet: no lead is made, and the chat waits unmatched for staff. */
export const unwiredIngest: IngestLeadPort = () => Promise.resolve(null);

/** A provider id as `crm.lead.ingest` takes it; anything else is left out. */
const WORKSHOP_DEFAULTS_PIPELINE = WORKSHOP_DEFAULTS.whatsapp.leadPipelineKey;
const PROVIDER_REF = /^[A-Za-z0-9_.:=+/-]{1,200}$/;
const ref = (value: string | undefined): string | undefined =>
  value !== undefined && PROVIDER_REF.test(value) ? value : undefined;

/** The intake's call for a message from a number no customer holds. */
export function ingestCallFor(
  entityId: number,
  message: WhatsAppInboundMessage,
  profileName: string | undefined,
): WhatsAppIngestCall | null {
  const externalId = ref(message.id);
  if (externalId === undefined) return null;
  const referral = message.referral;
  const attribution: NonNullable<WhatsAppIngestCall['input']['attribution']> = {};
  const clid = ref(referral?.ctwa_clid);
  if (clid !== undefined) attribution.ctwaClid = clid;
  const sourceId = ref(referral?.source_id);
  if (sourceId !== undefined) attribution.referralSourceId = sourceId;
  const sourceType = referral?.source_type?.trim() ?? '';
  if (sourceType !== '') attribution.referralSourceType = sourceType.slice(0, 40);
  if (referral?.source_url?.startsWith('https://') === true) {
    attribution.sourceUrl = referral.source_url.slice(0, 500);
  }
  const name = profileName?.trim().slice(0, 120) ?? '';
  return {
    input: {
      entityId,
      channel: 'whatsapp',
      pipelineKey: WORKSHOP_DEFAULTS_PIPELINE,
      externalId,
      contact: { name: name === '' ? `+${message.from}` : name, phone: `+${message.from}` },
      ...(Object.keys(attribution).length === 0 ? {} : { attribution }),
    },
    idempotencyKey: `whatsapp:${externalId}`,
  };
}

export interface WhatsAppHandlerDeps {
  keyValue: KeyValue;
  now: () => Date;
  ingestLead: IngestLeadPort;
  /** Downloads a customer's file by its media id; undefined while WhatsApp is not set up here. */
  downloadMedia: ((mediaId: string) => Promise<DownloadedMedia>) | undefined;
  /** Where a customer's file is kept; undefined where no store is set up. */
  store: FileStore | undefined;
  logger?: Logger;
}

/** Why a chat goes to people when the customer writes HUMAN. */
const KEYWORD_HANDOFF = 'keyword';

/** The file types a customer's message brings in: photos and PDFs, as the file checks read them. */
const MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

/** Meta's template events, as a template's status reads them; others change nothing. */
const TEMPLATE_EVENTS: Readonly<Record<string, 'pending' | 'approved' | 'rejected' | 'paused' | 'disabled'>> = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REINSTATED: 'approved',
  REJECTED: 'rejected',
  PAUSED: 'paused',
  DISABLED: 'disabled',
  PENDING_DELETION: 'disabled',
  DELETED: 'disabled',
};

/** What a message is, as the BOS records it: its kind, the customer's text and a button's id. */
function readMessage(message: WhatsAppInboundMessage): {
  kind: 'text' | 'media' | 'button';
  body: string | null;
  buttonPayload: string | null;
  mediaId: string | undefined;
  mediaType: string | undefined;
} | null {
  const text = (value: string | undefined): string | null => {
    const trimmed = value?.trim() ?? '';
    return trimmed === '' ? null : trimmed.slice(0, 4096);
  };
  const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
  switch (message.type) {
    case 'text':
      return message.text === undefined
        ? null
        : { kind: 'text', body: text(message.text.body), buttonPayload: null, mediaId: undefined, mediaType: undefined };
    case 'button':
      return {
        kind: 'button',
        body: text(message.button?.text),
        buttonPayload: text(message.button?.payload)?.slice(0, 256) ?? null,
        mediaId: undefined,
        mediaType: undefined,
      };
    case 'interactive':
      return reply === undefined
        ? null
        : { kind: 'button', body: text(reply.title), buttonPayload: reply.id.slice(0, 256), mediaId: undefined, mediaType: undefined };
    case 'reaction':
      // A reaction to a message is no message of its own.
      return null;
    case 'image':
    case 'document': {
      const media = message.image ?? message.document;
      return {
        kind: 'media',
        body: text(media?.caption),
        buttonPayload: null,
        mediaId: media?.id,
        mediaType: media?.mime_type,
      };
    }
    default:
      // A voice note, video, sticker, place or contact card: recorded as something sent, with no
      // file kept; the chat says the customer sent something it cannot show.
      return { kind: 'media', body: null, buttonPayload: null, mediaId: undefined, mediaType: undefined };
  }
}

/** Unix seconds as Meta sends them, as an instant. */
const instant = (seconds: string): string => new Date(Number(seconds) * 1000).toISOString();

/**
 * The `meta_whatsapp` handler (docs/03-roadmap-appendix/phase2.md §6.1) on P5's webhook worker.
 * Each change is first given its company, by the number Meta names (`app.whatsapp_channel_entity()`
 * as `system:workers` with no company), and every command then runs in a request scoped to that
 * one company, so a message for one company never writes in another; a change naming no active
 * number of any company records nothing and the row is processed with `whatsapp_number_unknown`.
 * For each message, in order: it is recorded once (a repeat changes nothing); a number no
 * customer holds goes to the lead intake, and the chat is matched to the customer it made; STOP
 * opts the number out and sends the one confirmation, HUMAN hands the chat to people; a chat's
 * first message sends the welcome; a photo or PDF is downloaded with the system key, stored and
 * attached to the message for its checks. Statuses move a message forward; template events record
 * a template's status in each company that registered it; a quality update is kept for Integration
 * Health. Customer text is untrusted and never logged.
 */
export function whatsappHandler(deps: WhatsAppHandlerDeps) {
  const log = deps.logger ?? appLogger;
  return async (payload: WhatsAppWebhook, context: WebhookHandlerContext): Promise<WebhookHandled> => {
    const companies = new Set<number>();
    let unknown = false;
    const findCompany = (ref: { phoneNumberId?: string; numberE164?: string }) =>
      executeQuery(
        systemWorkersPrincipal(null),
        { entityIds: [], requestId: context.requestId },
        (ctx) => whatsappChannelEntity(ctx, ref),
        { name: 'messaging.channel_entity' },
      );

    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        if (change.field === 'messages') {
          const value = change.value as Extract<
            WhatsAppWebhook['entry'][number]['changes'][number],
            { field: 'messages' }
          >['value'];
          const entityId = await findCompany({ phoneNumberId: value.metadata.phone_number_id });
          if (entityId === null) {
            unknown = true;
            continue;
          }
          companies.add(entityId);
          const scope = { entityIds: [entityId], requestId: context.requestId };
          const principal = systemWorkersPrincipal(entityId);
          const run = <T>(command: Parameters<typeof executeCommand>[2], input: unknown) =>
            executeCommand(principal, scope, command, input) as Promise<T>;
          const profiles = new Map(
            (value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name] as const),
          );
          for (const message of value.messages ?? []) {
            await handleMessage(message, entityId, value.metadata.phone_number_id, profiles, run);
          }
          for (const status of value.statuses ?? []) {
            await handleStatus(status, run);
          }
        } else if (change.field === 'message_template_status_update') {
          const value = change.value as { event: string; message_template_name: string; message_template_language: string };
          const status = TEMPLATE_EVENTS[value.event.toUpperCase()];
          const language = value.message_template_language.toLowerCase().startsWith('en') ? 'en' : null;
          if (status === undefined || language === null) continue;
          const name = value.message_template_name;
          const owners = await executeQuery(
            systemWorkersPrincipal(null),
            { entityIds: [], requestId: context.requestId },
            (ctx) => whatsappTemplateEntities(ctx, name, language),
            { name: 'messaging.template_entities' },
          );
          for (const entityId of owners) {
            companies.add(entityId);
            await executeCommand(
              systemWorkersPrincipal(entityId),
              { entityIds: [entityId], requestId: context.requestId },
              recordWhatsAppTemplateStatus,
              { name, language, status },
            );
          }
        } else if (change.field === 'phone_number_quality_update') {
          const value = change.value as { display_phone_number: string; event: string; current_limit?: string };
          const digits = value.display_phone_number.replace(/\D/g, '');
          const entityId = await findCompany({ numberE164: `+${digits}` });
          if (entityId === null) {
            unknown = true;
            continue;
          }
          companies.add(entityId);
          await recordQuality(deps.keyValue, entityId, value.event, value.current_limit, deps.now());
        }
      }
    }
    const [only] = companies;
    return {
      entityId: companies.size === 1 && only !== undefined ? only : null,
      ...(unknown && companies.size === 0 ? { code: 'whatsapp_number_unknown' } : {}),
    };
  };

  async function handleMessage(
    message: WhatsAppInboundMessage,
    entityId: number,
    phoneNumberId: string,
    profiles: Map<string, string | undefined>,
    run: <T>(command: Parameters<typeof executeCommand>[2], input: unknown) => Promise<T>,
  ): Promise<void> {
    const read = readMessage(message);
    if (read === null) return;
    const recorded = await run<{
      threadId: string;
      messageId: string;
      duplicate: boolean;
      firstMessage: boolean;
      accountId: string | null;
      holders: number;
      optedOut: boolean;
    }>(recordInboundWhatsApp, {
      phoneNumberId,
      waId: message.from,
      providerMessageId: message.id,
      kind: read.kind,
      body: read.body,
      buttonPayload: read.buttonPayload,
      sentAt: instant(message.timestamp),
    });
    const thread = { entityId, threadId: recorded.threadId };

    // A file is kept even when the message was recorded before, since an earlier try may have
    // stopped before it; the file's id is the message's, so it is stored and attached once.
    if (read.kind === 'media' && read.mediaId !== undefined) {
      await keepMedia(entityId, recorded.messageId, read.mediaId, read.mediaType, run);
    }
    if (recorded.duplicate) return;

    if (recorded.accountId === null && recorded.holders === 0) {
      const call = ingestCallFor(entityId, message, profiles.get(message.from));
      const made = call === null ? null : await deps.ingestLead(call);
      if (made !== null) {
        await run(matchWhatsAppThread, { ...thread, accountId: made.accountId });
      }
    }

    const keyword = read.kind === 'media' ? null : matchKeyword(read.body);
    if (keyword === 'stop') {
      const stop = await run<{ newly: boolean }>(recordWhatsAppOptOut, {
        ...thread,
        at: instant(message.timestamp),
      });
      if (stop.newly) await run(queueWhatsAppMessage, { ...thread, purpose: 'opt_out_confirmation' });
      return;
    }
    if (keyword === 'human') {
      const handOff = { ...thread, reason: KEYWORD_HANDOFF };
      await run(recordWhatsAppHandOff, handOff);
    }
    // The welcome on a chat's first message (question 2 (a)); a customer who asked for a person
    // with their first word has people answering instead.
    if (recorded.firstMessage && !recorded.optedOut && keyword === null) {
      await run(queueWhatsAppMessage, { ...thread, purpose: 'welcome' });
    }
  }

  async function handleStatus(
    status: WhatsAppStatus,
    run: <T>(command: Parameters<typeof executeCommand>[2], input: unknown) => Promise<T>,
  ): Promise<void> {
    if (status.status === 'deleted') return;
    const code = status.errors?.[0]?.code;
    await run(recordWhatsAppStatus, {
      providerMessageId: status.id,
      status: status.status,
      at: instant(status.timestamp),
      errorCode: code === undefined || code < 0 ? null : code,
    });
  }

  async function keepMedia(
    entityId: number,
    messageId: string,
    mediaId: string,
    mediaType: string | undefined,
    run: <T>(command: Parameters<typeof executeCommand>[2], input: unknown) => Promise<T>,
  ): Promise<void> {
    const type = mediaType?.split(';')[0]?.trim().toLowerCase();
    if (type === undefined || !MEDIA_TYPES.has(type)) return;
    if (deps.downloadMedia === undefined || deps.store === undefined) {
      // Retried until WhatsApp and a file store are set up: the file is the customer's, not lost.
      throw new DomainError('integration_unavailable', 'no WhatsApp media download or file store here');
    }
    const media = await deps.downloadMedia(mediaId);
    if (!MEDIA_TYPES.has(media.contentType)) {
      log.log('warn', 'messaging.media_refused', { messageId, contentType: media.contentType });
      return;
    }
    const contentType = media.contentType as 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
    const key = uploadKey(entityId, 'whatsapp_media', messageId, contentType);
    await deps.store.put(key, media.bytes, contentType);
    await run(attachWhatsAppMedia, {
      entityId,
      messageId,
      fileId: messageId,
      bucket: deps.store.bucket,
      key,
      contentType,
      size: media.bytes.length,
      sha256: createHash('sha256').update(media.bytes).digest('hex'),
    });
  }
}
