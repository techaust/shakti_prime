import { commandOptions } from '../../actions/support';
import { fieldCipher } from '../../crypto/kms-cipher';
import type { TallyRouteDeps } from './routes';

/**
 * The connector routes' real dependencies: the clock, the field cipher that opens the connectors'
 * sealed keys (KMS on a hosted environment) and the outbox nudge after a commit.
 */
export function tallyRouteDeps(): TallyRouteDeps {
  return {
    now: () => new Date(),
    cipher: () => fieldCipher(),
    options: (meta) => commandOptions(meta),
  };
}
