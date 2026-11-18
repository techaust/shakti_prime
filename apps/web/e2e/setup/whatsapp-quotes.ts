// The WhatsApp quote journeys' fixtures (`e2e/whatsapp-quotes.spec.ts`, docs/03-roadmap-appendix/
// phase2.md §7.1), written by the seed on the host. In the snapshot company, which has a WhatsApp
// number (whatsapp.ts) and the journeys' price list (quotes.ts), and in the quote journeys'
// company, given a WhatsApp number here: their quote and order templates, approved as Meta's
// events would approve them and mapped to the two customer updates as an Executive maps them. In
// the quote journeys' company, per project a sized lead on the journeys' tier whose customer
// writes on WhatsApp and agreed to get messages there, whose quote the journey makes and sends,
// so no journey adds a row to the snapshot company. In the snapshot company, one quote the seed
// sends on WhatsApp and the platform accepts with a one-time code, as the press and the code
// would. Every name here is a test value for the journeys alone.
import { newId, SYSTEM_WORKERS_PRINCIPAL_ID, type Principal } from '@shakti/contracts';
import { asMigrator, principalFor } from '@shakti/db/testing';
import {
  acceptQuoteRemote,
  createQuote,
  executeCommand,
  recordInboundWhatsApp,
  recordWhatsAppTemplateStatus,
  registerWhatsAppTemplate,
  sendQuote,
  setEntityChannel,
  setWhatsAppMilestone,
} from '@shakti/domain';
import {
  PROJECTS,
  QUOTE_JOURNEY_COMPANY,
  SNAPSHOT_COMPANY,
  WHATSAPP,
  WHATSAPP_QUOTES,
  type WhatsAppQuoteSeed,
} from '../support/users';
import { deliverWaitingEvents } from './deliver-waiting';
import { ensureSizedLead, QUOTE_JOURNEY_IDS } from './quotes';

/** The snapshot company: the seed's accepted quote alone, so its lists show the same rows each run. */
const E = SNAPSHOT_COMPANY.entityId;
/**
 * The quote journeys' company: each project's lead, whose quote the journey makes and sends, so no
 * journey adds a row to the snapshot company's lists, held-back updates or counts.
 */
const J = QUOTE_JOURNEY_COMPANY.entityId;
type Company = typeof E | typeof J;
const scopeOf = (entityId: Company) => ({ entityIds: [entityId] });
const scope = scopeOf(E);
const waIdOf = (typed: string): string => `91${typed.replace(/\D/g, '')}`;
const workers = (entityId: Company = E) =>
  principalFor('system:workers', [entityId], { id: SYSTEM_WORKERS_PRINCIPAL_ID });

/** The quote journeys' company's WhatsApp number, set as an Executive sets it. */
async function ensureChannel(executive: Principal, entityId: typeof J): Promise<void> {
  const number = WHATSAPP.numbers[entityId];
  await executeCommand(executive, scopeOf(entityId), setEntityChannel, {
    entityId,
    channel: 'whatsapp',
    number: number.e164,
    providerRef: number.phoneNumberId,
    verified: true,
  });
}

/** The template, registered and approved once; a quote's carries its PDF as the header. */
async function ensureTemplate(
  executive: Principal,
  entityId: Company,
  template: { name: string; label: string },
  params: string[],
  buttons: { kind: 'quick_reply'; text: string }[],
  header: 'none' | 'document' = 'none',
): Promise<string> {
  const made = await executeCommand(executive, scopeOf(entityId), registerWhatsAppTemplate, {
    entityId,
    name: template.name,
    label: template.label,
    category: 'utility',
    params,
    buttons,
    header,
  });
  await executeCommand(workers(entityId), scopeOf(entityId), recordWhatsAppTemplateStatus, {
    name: template.name,
    language: 'en',
    status: 'approved',
  });
  return made.id;
}

/** The customer's chat, opened (or its window opened again) by a message, and their consent. */
async function ensureChat(entityId: Company, accountId: string, phone: string): Promise<void> {
  await executeCommand(workers(entityId), scopeOf(entityId), recordInboundWhatsApp, {
    phoneNumberId: WHATSAPP.numbers[entityId].phoneNumberId,
    waId: waIdOf(phone),
    providerMessageId: `wamid.e2e.${newId()}`,
    kind: 'text',
    body: 'Please send me the quote on WhatsApp.',
    buttonPayload: null,
    sentAt: new Date().toISOString(),
    handledBy: 'people',
  });
  await asMigrator(
    (
      m,
    ) => m`insert into consents (id, contact_id, channel, purpose, source, text_version, given_at, created_by)
             select ${newId()}, ac.contact_id, 'whatsapp', 'service', 'whatsapp_opt_in', 'e2e', now(),
                    ${SYSTEM_WORKERS_PRINCIPAL_ID}
               from account_contacts ac
              where ac.account_id = ${accountId}
                and not exists (select 1 from consents c where c.contact_id = ac.contact_id
                                   and c.channel = 'whatsapp' and c.withdrawn_at is null)
              limit 1`,
  );
}

/** The quote the platform accepted on WhatsApp with a code, made once. */
async function ensureAcceptedQuote(executive: Principal): Promise<{ id: string; quoteNo: string }> {
  const lead = await ensureSizedLead(executive, E, WHATSAPP_QUOTES.accepted, true);
  await ensureChat(E, lead.accountId, WHATSAPP_QUOTES.accepted.phone);
  const [found] = await asMigrator(
    (m) => m<{ id: string; quote_no: string; state: string; pdf: string | null }[]>`
      select id, quote_no, state, pdf_file_id as pdf from quotes
       where opportunity_id = ${lead.leadId} order by created_at limit 1`,
  );
  let quote = found;
  if (quote === undefined) {
    const made = await executeCommand(executive, scope, createQuote, {
      entityId: E,
      opportunityId: lead.leadId,
      lines: [{ itemId: QUOTE_JOURNEY_IDS.module, qty: '5' }],
    });
    quote = { id: made.id, quote_no: made.quoteNo, state: made.state, pdf: null };
  }
  if (quote.state === 'draft') {
    // The quote is printed by its worker before it can be sent.
    await deliverWaitingEvents();
    await executeCommand(executive, scope, sendQuote, {
      entityId: E,
      quoteId: quote.id,
      channel: 'whatsapp',
    });
    quote = { ...quote, state: 'sent' };
  }
  if (quote.state === 'sent') {
    const [thread] = await asMigrator(
      (m) => m<{ id: string }[]>`select id from whatsapp_threads
                                  where entity_id = ${E} and account_id = ${lead.accountId}
                                  order by last_inbound_at desc nulls last limit 1`,
    );
    await executeCommand(workers(), scope, acceptQuoteRemote, {
      entityId: E,
      quoteId: quote.id,
      threadId: thread?.id ?? '',
      acceptedVia: 'whatsapp_otp',
    });
  }
  return { id: quote.id, quoteNo: quote.quote_no };
}

/** Makes the WhatsApp quote fixtures and answers what the journeys need of them. */
export async function ensureWhatsAppQuoteJourneys(executiveId: string): Promise<WhatsAppQuoteSeed> {
  const executive = principalFor('executive', [1, 2, 3, 4], { id: executiveId });
  await ensureChannel(executive, J);
  // Both companies send the two updates with the same approved templates.
  for (const entityId of [E, J] as const) {
    const quoteTemplate = await ensureTemplate(
      executive,
      entityId,
      WHATSAPP_QUOTES.templates.quote,
      ['Quote number', 'Total', 'Valid until'],
      [
        { kind: 'quick_reply', text: 'Accept' },
        { kind: 'quick_reply', text: 'Talk to us' },
      ],
      'document',
    );
    const orderTemplate = await ensureTemplate(
      executive,
      entityId,
      WHATSAPP_QUOTES.templates.order,
      ['Order number', 'Total'],
      [],
    );
    for (const [milestone, templateId] of [
      ['quote_sent', quoteTemplate],
      ['order_confirmed', orderTemplate],
    ] as const) {
      await executeCommand(executive, scopeOf(entityId), setWhatsAppMilestone, {
        entityId,
        milestone,
        templateId,
        isActive: true,
      });
    }
  }

  const leads = {} as WhatsAppQuoteSeed['leads'];
  for (const project of PROJECTS) {
    const lead = WHATSAPP_QUOTES.leads[project];
    const made = await ensureSizedLead(executive, J, lead, true);
    await ensureChat(J, made.accountId, lead.phone);
    leads[project] = { accountId: made.accountId, name: lead.name };
  }
  const accepted = await ensureAcceptedQuote(executive);
  return { leads, acceptedQuoteId: accepted.id, acceptedQuoteNo: accepted.quoteNo };
}
