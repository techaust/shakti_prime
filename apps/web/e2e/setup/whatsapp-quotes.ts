// The WhatsApp quote journeys' fixtures (`e2e/whatsapp-quotes.spec.ts`, docs/03-roadmap-appendix/
// phase2.md §7.1), written by the seed on the host in the snapshot company, which has a WhatsApp
// number (whatsapp.ts) and the journeys' price list (quotes.ts): its quote and order templates,
// approved as Meta's events would approve them and mapped to the two customer updates as an
// Executive maps them; per project a sized lead on the journeys' tier whose customer writes on
// WhatsApp and agreed to get messages there; and one quote the seed sends on WhatsApp and the
// platform accepts with a one-time code, as the press and the code would. Every name here is a
// test value for the journeys alone.
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
  setWhatsAppMilestone,
} from '@shakti/domain';
import {
  PROJECTS,
  SNAPSHOT_COMPANY,
  WHATSAPP,
  WHATSAPP_QUOTES,
  type WhatsAppQuoteSeed,
} from '../support/users';
import { deliverWaitingEvents } from './deliver-waiting';
import { ensureSizedLead, QUOTE_JOURNEY_IDS } from './quotes';

const E = SNAPSHOT_COMPANY.entityId;
const scope = { entityIds: [E] };
const waIdOf = (typed: string): string => `91${typed.replace(/\D/g, '')}`;
const workers = () => principalFor('system:workers', [E], { id: SYSTEM_WORKERS_PRINCIPAL_ID });

/** The template, registered and approved once; a quote's carries its PDF as the header. */
async function ensureTemplate(
  executive: Principal,
  template: { name: string; label: string },
  params: string[],
  buttons: { kind: 'quick_reply'; text: string }[],
  header: 'none' | 'document' = 'none',
): Promise<string> {
  const made = await executeCommand(executive, scope, registerWhatsAppTemplate, {
    entityId: E,
    name: template.name,
    label: template.label,
    category: 'utility',
    params,
    buttons,
    header,
  });
  await executeCommand(workers(), scope, recordWhatsAppTemplateStatus, {
    name: template.name,
    language: 'en',
    status: 'approved',
  });
  return made.id;
}

/** The customer's chat, opened (or its window opened again) by a message, and their consent. */
async function ensureChat(accountId: string, phone: string): Promise<void> {
  await executeCommand(workers(), scope, recordInboundWhatsApp, {
    phoneNumberId: WHATSAPP.numbers[3].phoneNumberId,
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
  await ensureChat(lead.accountId, WHATSAPP_QUOTES.accepted.phone);
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
  const quoteTemplate = await ensureTemplate(
    executive,
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
    WHATSAPP_QUOTES.templates.order,
    ['Order number', 'Total'],
    [],
  );
  for (const [milestone, templateId] of [
    ['quote_sent', quoteTemplate],
    ['order_confirmed', orderTemplate],
  ] as const) {
    await executeCommand(executive, scope, setWhatsAppMilestone, {
      entityId: E,
      milestone,
      templateId,
      isActive: true,
    });
  }

  const leads = {} as WhatsAppQuoteSeed['leads'];
  for (const project of PROJECTS) {
    const lead = WHATSAPP_QUOTES.leads[project];
    const made = await ensureSizedLead(executive, E, lead, true);
    await ensureChat(made.accountId, lead.phone);
    leads[project] = { accountId: made.accountId, name: lead.name };
  }
  const accepted = await ensureAcceptedQuote(executive);
  return { leads, acceptedQuoteId: accepted.id, acceptedQuoteNo: accepted.quoteNo };
}
