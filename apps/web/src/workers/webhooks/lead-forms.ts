import type {
  IngestChannel,
  IngestSourceProvider,
  LeadAttribution,
  MetaLeadDetails,
} from '@shakti/contracts';
import {
  executeCommand,
  executeQuery,
  findIngestSource,
  formQuestions,
  ingestIdempotencyKey,
  ingestLead,
  ingestSourceToken,
  mapFormAnswers,
  recordSourceQuestions,
  type FieldCipher,
  type FormAnswer,
  type FoundIngestSource,
} from '@shakti/domain';
import { fieldCipher } from '../../crypto/kms-cipher';
import { ProviderError } from '../../integrations/http';
import { metaLeadClient, type MetaLeadClient } from '../../integrations/meta-leadgen/client';
import { logger } from '../../log';
import { systemWorkersPrincipal } from '../events/system-principal';
import type { WebhookPayload } from './contracts';
import type { WebhookHandled, WebhookHandlerContext } from './registry';

/**
 * The Lead Ads and Google lead form handlers (docs/03-roadmap-appendix/phase2.md §6.2), run by the
 * webhook worker as `system:workers`:
 * - the form is found by its id among the companies' connected sources (`app.ingest_source()`);
 *   a form nobody has connected is set aside as `form_unmapped`, never guessed, and shows on
 *   Integration health with Process again for once it is connected;
 * - Meta's lead is read from the Graph API with the source's Page token, opened with the field
 *   cipher; a token Meta refuses sets the row aside as `page_token_refused`, a slow or failing
 *   Graph API is retried by the worker;
 * - the form's questions are recorded for the field map's preview (keys and labels only);
 * - the answers are read by the field map (`mapFormAnswers()`): a map that gives no name or no
 *   phone sets the row aside as `form_map_incomplete`; a consent only from a ticked consent
 *   question;
 * - the lead is made or attached by `crm.lead.ingest`, keyed on the provider's lead id, so a
 *   repeated event makes nothing;
 * - Google's "send test data" lead is recorded for the preview and makes no lead (`test_lead`).
 * Logs carry ids and codes only.
 */

export interface LeadFormDeps {
  meta: MetaLeadClient;
  cipher: () => FieldCipher | undefined;
}

const defaultDeps = (): LeadFormDeps => ({ meta: metaLeadClient(), cipher: () => fieldCipher() });

/** The platform with no company: a delivery names none until its form is found. */
async function lookUpSource(
  provider: IngestSourceProvider,
  formId: string,
  requestId: string,
): Promise<FoundIngestSource | undefined> {
  return executeQuery(
    systemWorkersPrincipal(null),
    { entityIds: [], requestId },
    (ctx) => findIngestSource(ctx, provider, formId),
    { name: 'findIngestSource' },
  );
}

async function recordQuestions(
  source: FoundIngestSource,
  answers: readonly FormAnswer[],
  requestId: string,
): Promise<void> {
  await executeCommand(
    systemWorkersPrincipal(source.entityId),
    { entityIds: [source.entityId], requestId },
    recordSourceQuestions,
    { entityId: source.entityId, sourceId: source.sourceId, questions: formQuestions(answers) },
  );
}

/** Makes or attaches the lead of one form's answers; a code when it is set aside instead. */
async function ingestAnswers(
  args: {
    source: FoundIngestSource;
    channel: IngestChannel;
    externalId: string;
    answers: readonly FormAnswer[];
    attribution: LeadAttribution;
    givenAt: string;
  },
  requestId: string,
): Promise<'form_map_incomplete' | undefined> {
  const { source } = args;
  const mapped = mapFormAnswers(
    args.answers,
    { fieldMap: source.fieldMap, consent: source.consent },
    args.givenAt,
  );
  if (!mapped.ok) return 'form_map_incomplete';
  const input = {
    entityId: source.entityId,
    channel: args.channel,
    sourceId: source.sourceId,
    externalId: args.externalId,
    contact: mapped.contact,
    ...(mapped.site === undefined ? {} : { site: mapped.site }),
    attribution: args.attribution,
    ...(mapped.consent === undefined ? {} : { consent: mapped.consent }),
    ...(mapped.qualification === undefined ? {} : { qualification: mapped.qualification }),
    ...(mapped.message === undefined ? {} : { message: mapped.message }),
  };
  await executeCommand(
    systemWorkersPrincipal(source.entityId),
    { entityIds: [source.entityId], requestId },
    ingestLead,
    input,
    { idempotencyKey: ingestIdempotencyKey(args.channel, args.externalId) },
  );
  return undefined;
}

/** A provider id kept as attribution only when it reads as one. */
function ref(value: unknown): string | undefined {
  const text = typeof value === 'number' ? String(value) : value;
  return typeof text === 'string' && /^[A-Za-z0-9_.:=+/-]{1,200}$/.test(text) ? text : undefined;
}

function attribution(fields: Record<string, unknown>): LeadAttribution {
  return Object.fromEntries(
    Object.entries(fields).flatMap(([k, v]) => {
      const r = ref(v);
      return r === undefined ? [] : [[k, r]];
    }),
  );
}

/** Meta's answers: each question's values joined, and each consent box as yes or no. */
export function metaAnswers(lead: MetaLeadDetails): FormAnswer[] {
  const answers: FormAnswer[] = lead.field_data.map((f) => ({
    key: f.name,
    label: null,
    value: f.values.join(', '),
  }));
  const boxes = (lead as { custom_disclaimer_responses?: unknown }).custom_disclaimer_responses;
  if (Array.isArray(boxes)) {
    for (const box of boxes) {
      const b = box as { checkbox_key?: unknown; is_checked?: unknown };
      if (typeof b.checkbox_key === 'string') {
        answers.push({
          key: b.checkbox_key,
          label: null,
          value: b.is_checked === true || b.is_checked === '1' ? 'yes' : 'no',
        });
      }
    }
  }
  return answers;
}

/** When Meta says the lead was made, as an instant; the time it was handled otherwise. */
function instant(value: string | undefined, fallback: Date): string {
  const at = value === undefined ? Number.NaN : Date.parse(value);
  return Number.isNaN(at) ? fallback.toISOString() : new Date(at).toISOString();
}

export function metaLeadgenHandler(deps: () => LeadFormDeps = defaultDeps) {
  return async function handleMetaLeadgen(
    payload: WebhookPayload<'meta_leadgen'>,
    context: WebhookHandlerContext,
  ): Promise<WebhookHandled> {
    const { meta, cipher } = deps();
    const { requestId } = context;
    let entityId: number | null = null;
    let setAside: string | undefined;
    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        const value = change.value;
        const source = await lookUpSource('meta_leadgen', value.form_id, requestId);
        if (source === undefined) {
          setAside ??= 'form_unmapped';
          continue;
        }
        entityId = source.entityId;
        const sealed = await executeQuery(
          systemWorkersPrincipal(source.entityId),
          { entityIds: [source.entityId], requestId },
          (ctx) => ingestSourceToken(ctx, source.sourceId),
          { name: 'ingestSourceToken' },
        );
        const opener = cipher();
        if (sealed === undefined || opener === undefined) {
          setAside ??= 'page_token_missing';
          continue;
        }
        const token = await opener.decrypt(sealed, {
          table: 'ingest_sources',
          column: 'page_token_sealed',
          entityId: source.entityId,
          rowId: source.sourceId,
        });
        let lead: MetaLeadDetails;
        try {
          lead = await meta.fetchLead(value.leadgen_id, token);
        } catch (error) {
          if (error instanceof ProviderError && !error.retryable) {
            logger.log('warn', 'leadgen.fetch_refused', {
              requestId,
              inboxId: context.inboxId,
              status: error.status,
              vendorCode: error.vendorCode,
            });
            setAside ??= 'page_token_refused';
            continue;
          }
          throw error;
        }
        const answers = metaAnswers(lead);
        await recordQuestions(source, answers, requestId);
        const code = await ingestAnswers(
          {
            source,
            channel: 'meta_ads',
            externalId: value.leadgen_id,
            answers,
            attribution: attribution({
              campaignId: lead.campaign_id,
              adsetId: (lead as { adset_id?: unknown }).adset_id ?? value.adgroup_id,
              adId: lead.ad_id ?? value.ad_id,
              formId: value.form_id,
              pageId: value.page_id,
            }),
            givenAt: instant(lead.created_time, new Date(value.created_time * 1000)),
          },
          requestId,
        );
        if (code !== undefined) setAside ??= code;
      }
    }
    return setAside === undefined ? { entityId } : { entityId, code: setAside, failed: true };
  };
}

export function googleLeadformHandler() {
  return async function handleGoogleLeadform(
    payload: WebhookPayload<'google_leadform'>,
    context: WebhookHandlerContext,
  ): Promise<WebhookHandled> {
    const { requestId } = context;
    const formId = String(payload.form_id);
    const source = await lookUpSource('google_leadform', formId, requestId);
    if (source === undefined) return { entityId: null, code: 'form_unmapped', failed: true };
    const answers: FormAnswer[] = payload.user_column_data.map((c) => ({
      key: c.column_id,
      label: c.column_name ?? null,
      value: c.string_value,
    }));
    await recordQuestions(source, answers, requestId);
    // Google's "send test data": recorded for the preview, never a lead.
    if (payload.is_test === true) return { entityId: source.entityId, code: 'test_lead' };
    const code = await ingestAnswers(
      {
        source,
        channel: 'google_ads',
        externalId: payload.lead_id,
        answers,
        attribution: attribution({
          campaignId: payload.campaign_id,
          adsetId: payload.adgroup_id,
          adId: payload.creative_id,
          formId,
          gclid: payload.gcl_id,
        }),
        givenAt: instant(payload.lead_submit_time, new Date()),
      },
      requestId,
    );
    return code === undefined
      ? { entityId: source.entityId }
      : { entityId: source.entityId, code, failed: true };
  };
}

export const handleMetaLeadgen = metaLeadgenHandler();
export const handleGoogleLeadform = googleLeadformHandler();
