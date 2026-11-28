import { commandOptions } from '../actions/support';
import { defaultMobileDeps } from '../auth/mobile-routes';
import type { SyncRouteDeps } from './routes';

/** The sync routes' real dependencies: the mobile routes' own, and the outbox nudge on commit. */
export function syncRouteDeps(): SyncRouteDeps {
  return {
    ...defaultMobileDeps(),
    executeOptions: (meta) => commandOptions({ client: meta.client ?? {} }),
  };
}
