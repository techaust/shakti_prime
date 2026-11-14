import { newId, SYSTEM_WORKERS_PRINCIPAL_ID } from '@shakti/contracts';
import { asMigrator, principalFor } from '@shakti/db/testing';
import {
  executeCommand,
  recordInboundWhatsApp,
  recordWhatsAppTemplateStatus,
  registerWhatsAppTemplate,
  setEntityChannel,
} from '@shakti/domain';
import { PROJECTS, SNAPSHOT_COMPANY, WHATSAPP } from '../support/users';

/** The number WhatsApp names a customer's phone by: its E.164 digits without the plus. */
const waIdOf = (typed: string): string => `91${typed.replace(/\D/g, '')}`;

/**
 * WhatsApp for the journeys (messages.spec.ts, docs/03-roadmap-appendix/phase2.md §6.1): company
 * 1's and the snapshot company's numbers with their provider references, set as an Executive sets
 * them; an approved template of each; and, recorded as the platform records Meta's deliveries, a
 * new message from each project's customer in company 1 (so each run's reply window is open and the
 * chat waits for a reply) and the snapshot company's one chat, written once and kept open.
 */
export async function ensureWhatsAppJourneys(executiveId: string): Promise<void> {
  const executive = principalFor('executive', [1, 2, 3, 4], { id: executiveId });
  for (const entityId of [1, SNAPSHOT_COMPANY.entityId] as const) {
    const number = WHATSAPP.numbers[entityId];
    await executeCommand(executive, { entityIds: [entityId] }, setEntityChannel, {
      entityId,
      channel: 'whatsapp',
      number: number.e164,
      providerRef: number.phoneNumberId,
      verified: true,
    });
    await executeCommand(executive, { entityIds: [entityId] }, registerWhatsAppTemplate, {
      entityId,
      name: WHATSAPP.template.name,
      category: 'utility',
      params: [WHATSAPP.template.meaning],
    });
    const workers = principalFor('system:workers', [entityId], { id: SYSTEM_WORKERS_PRINCIPAL_ID });
    await executeCommand(workers, { entityIds: [entityId] }, recordWhatsAppTemplateStatus, {
      name: WHATSAPP.template.name,
      language: 'en',
      status: 'approved',
    });
  }

  const inbound = (entityId: number, waId: string, body: string) =>
    executeCommand(
      principalFor('system:workers', [entityId], { id: SYSTEM_WORKERS_PRINCIPAL_ID }),
      { entityIds: [entityId] },
      recordInboundWhatsApp,
      {
        phoneNumberId: WHATSAPP.numbers[entityId as 1 | 3].phoneNumberId,
        waId,
        providerMessageId: `wamid.e2e.${newId()}`,
        kind: 'text',
        body,
        buttonPayload: null,
        sentAt: new Date().toISOString(),
      },
    );
  for (const project of PROJECTS) {
    const customer = WHATSAPP.customers[project];
    await inbound(1, waIdOf(customer.phone), WHATSAPP.customerMessage);
  }

  const snapshotWaId = waIdOf(WHATSAPP.snapshot.customer.phone);
  const [found] = await asMigrator(
    (m) => m<{ id: string }[]>`select id from whatsapp_threads
                                where entity_id = ${SNAPSHOT_COMPANY.entityId} and wa_id = ${snapshotWaId}`,
  );
  if (found === undefined) {
    await inbound(SNAPSHOT_COMPANY.entityId, snapshotWaId, WHATSAPP.snapshot.message);
  }
  // The snapshot chat waits for its reply with its window open on every run, so its screenshot
  // shows the same reply box whatever day the database was made.
  await asMigrator(
    (m) => m`update whatsapp_threads
                set window_open_until = now() + interval '1 day', needs_reply = true,
                    handled_by = 'assistant', handoff_reason = null, handed_off_at = null
              where entity_id = ${SNAPSHOT_COMPANY.entityId} and wa_id = ${snapshotWaId}`,
  );
}
