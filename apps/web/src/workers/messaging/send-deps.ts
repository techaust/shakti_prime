import type { Principal } from '@shakti/contracts';
import type { KeyValue } from '@shakti/domain';
import { clientFor, whatsappAccess } from '../../integrations/whatsapp/media';
import type { SendDeps } from './send';

/** The messaging worker's dependencies on this runtime: the system key's client of each number. */
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
    now: () => new Date(),
    client: (phoneNumberId) => (access === undefined ? undefined : clientFor(access, phoneNumberId)),
  };
}
