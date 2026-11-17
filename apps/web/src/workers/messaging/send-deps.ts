import type { Principal } from '@shakti/contracts';
import type { KeyValue } from '@shakti/domain';
import { fileStore } from '../../files/store';
import { clientFor, whatsappAccess } from '../../integrations/whatsapp/media';
import { whatsappButtonSecret } from './button-secret';
import type { SendDeps } from './send';

/**
 * The messaging worker's dependencies on this runtime: the system key's client of each number, the
 * quote buttons' secret and the file store a quote's PDF is read from.
 */
export function sendDeps(
  principal: Principal,
  keyValue: KeyValue,
  requestId: string,
  hosted: boolean,
): SendDeps {
  const access = whatsappAccess();
  return {
    principal,
    keyValue,
    requestId,
    hosted,
    buttonSecret: whatsappButtonSecret(),
    store: fileStore(),
    now: () => new Date(),
    client: (phoneNumberId) =>
      access === undefined ? undefined : clientFor(access, phoneNumberId),
  };
}
