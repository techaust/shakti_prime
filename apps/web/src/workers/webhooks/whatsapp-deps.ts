import { defaultAuthDeps } from '../../auth/deps';
import { fileStore } from '../../files/store';
import { downloadMedia, whatsappAccess } from '../../integrations/whatsapp/media';
import { unwiredIngest, type WhatsAppHandlerDeps } from './whatsapp';

/**
 * The WhatsApp handler's dependencies on this runtime: the shared key-value store, the system
 * key's media download and the file store when each is set up, and the lead intake (wired to
 * `crm.lead.ingest` once I1 has merged).
 */
export function whatsappHandlerDeps(): WhatsAppHandlerDeps {
  const access = whatsappAccess();
  return {
    keyValue: defaultAuthDeps().keyValue,
    now: () => new Date(),
    ingestLead: unwiredIngest,
    downloadMedia: access === undefined ? undefined : (mediaId) => downloadMedia(access, mediaId),
    store: fileStore(),
  };
}
