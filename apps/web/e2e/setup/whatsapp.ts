import { newId, SYSTEM_WORKERS_PRINCIPAL_ID } from '@shakti/contracts';
import { asMigrator, principalFor } from '@shakti/db/testing';
import {
  executeCommand,
  expireWhatsAppMedia,
  recordInboundWhatsApp,
  recordWhatsAppTemplateStatus,
  registerWhatsAppTemplate,
  setEntityChannel,
} from '@shakti/domain';
import { PROJECTS, SNAPSHOT_COMPANY, WHATSAPP } from '../support/users';

/**
 * W2: a photo the customer sent more than three years ago (docs/03-roadmap-appendix/phase2.md
 * §11), recorded as the platform records it, its file attached as `messaging.media.attach` leaves
 * it, then removed by the retention job's own command, so the message keeps its caption and the
 * file's summary. No bytes are stored: the journeys' store never held them.
 */
async function removedPhoto(entityId: 1 | 3, waId: string): Promise<void> {
  const workers = principalFor('system:workers', [entityId], { id: SYSTEM_WORKERS_PRINCIPAL_ID });
  const recorded = await executeCommand(workers, { entityIds: [entityId] }, recordInboundWhatsApp, {
    phoneNumberId: WHATSAPP.numbers[entityId].phoneNumberId,
    waId,
    providerMessageId: `wamid.e2e.${newId()}`,
    kind: 'media',
    body: WHATSAPP.snapshot.removedPhotoCaption,
    buttonPayload: null,
    sentAt: new Date(Date.now() - (3 * 365 + 40) * 86_400_000).toISOString(),
    handledBy: 'people',
  });
  const fileId = newId();
  const key = `${String(entityId)}/whatsapp_media/${fileId}.jpg`;
  await asMigrator(async (m) => {
    await m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256,
                               status, created_by)
            values (${fileId}, ${entityId}, 'whatsapp_media', 'local', ${key}, ${`${fileId}.jpg`},
                    'image/jpeg', 245760, ${'0'.repeat(64)}, 'ready', ${SYSTEM_WORKERS_PRINCIPAL_ID})`;
    await m`update whatsapp_messages set file_id = ${fileId} where id = ${recorded.messageId}`;
  });
  await executeCommand(workers, { entityIds: [entityId] }, expireWhatsAppMedia, {
    entityId,
    messageIds: [recorded.messageId],
  });
}

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
      label: 'Visit update',
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
        handledBy: 'people',
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
  // W2: a photo of more than three years ago whose file the media retention job removed (its own
  // command), written once, so the chat shows the removed file's line.
  const [photo] = await asMigrator(
    (m) => m<{ id: string; removed: boolean }[]>`
      select msg.id, msg.media_summary is not null as removed from whatsapp_messages msg
        join whatsapp_threads t on t.id = msg.thread_id
       where t.entity_id = ${SNAPSHOT_COMPANY.entityId}
         and t.wa_id = ${snapshotWaId} and msg.kind = 'media'`,
  );
  if (photo === undefined) {
    await removedPhoto(SNAPSHOT_COMPANY.entityId, snapshotWaId);
  } else if (!photo.removed) {
    // A database made before the summary was kept: the job's command finishes the removal.
    const entityId = SNAPSHOT_COMPANY.entityId;
    await executeCommand(
      principalFor('system:workers', [entityId], { id: SYSTEM_WORKERS_PRINCIPAL_ID }),
      { entityIds: [entityId] },
      expireWhatsAppMedia,
      { entityId, messageIds: [photo.id] },
    );
  }
  // The snapshot chat waits for its reply with its window open on every run, so its screenshot
  // shows the same reply box whatever day the database was made. Every journey chat is answered
  // by people, as one a person took over is (a new chat starts with the assistant).
  await asMigrator(
    (m) => m`update whatsapp_threads
                set window_open_until = now() + interval '1 day', needs_reply = true,
                    handled_by = 'people', handoff_reason = 'request',
                    handed_off_at = coalesce(handed_off_at, now())
              where entity_id = ${SNAPSHOT_COMPANY.entityId} and wa_id = ${snapshotWaId}`,
  );
  await asMigrator(
    (m) => m`update whatsapp_threads
                set handled_by = 'people', handoff_reason = 'request',
                    handed_off_at = coalesce(handed_off_at, now())
              where entity_id = 1 and wa_id = any (${PROJECTS.map((p) => waIdOf(WHATSAPP.customers[p].phone))})
                and handled_by = 'assistant'`,
  );
}
