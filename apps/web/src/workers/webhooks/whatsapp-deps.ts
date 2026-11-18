import { isDomainError, newId } from '@shakti/contracts';
import { executeCommand, ingestLead } from '@shakti/domain';
import { defaultAuthDeps } from '../../auth/deps';
import { fileStore } from '../../files/store';
import { downloadMedia, whatsappAccess } from '../../integrations/whatsapp/media';
import { systemWorkersPrincipal } from '../events/system-principal';
import { whatsappButtonSecret } from '../messaging/button-secret';
import type { IngestLeadPort, WhatsAppHandlerDeps } from './whatsapp';

/**
 * The lead intake for a number no customer of the company holds: I1's `crm.lead.ingest`, run as
 * the platform in that one company with the message's idempotency key, so a repeated message makes
 * no second lead. A lead already made from the same message with other details (a delivery
 * processed again) is taken as done: the chat then waits unmatched for staff.
 */
export const ingestThroughCommand: IngestLeadPort = async ({ input, idempotencyKey }) => {
  try {
    const out = await executeCommand(
      systemWorkersPrincipal(input.entityId),
      { entityIds: [input.entityId], requestId: newId() },
      ingestLead,
      input,
      { idempotencyKey },
    );
    return { accountId: out.accountId };
  } catch (error) {
    if (isDomainError(error) && error.details?.reason === 'idempotency_mismatch') return null;
    throw error;
  }
};

/**
 * The WhatsApp handler's dependencies on this runtime: the shared key-value store, the system
 * key's media download and the file store when each is set up, the lead intake, and the quote
 * buttons' secret a one-time code is checked with.
 */
export function whatsappHandlerDeps(): WhatsAppHandlerDeps {
  const access = whatsappAccess();
  return {
    keyValue: defaultAuthDeps().keyValue,
    now: () => new Date(),
    ingestLead: ingestThroughCommand,
    downloadMedia: access === undefined ? undefined : (mediaId) => downloadMedia(access, mediaId),
    store: fileStore(),
    buttonSecret: whatsappButtonSecret(),
  };
}
