import { commandOptions } from '../../actions/support';
import type { TallyRouteDeps } from './routes';

/** The connector routes' real dependencies: the clock and the outbox nudge after a commit. */
export function tallyRouteDeps(): TallyRouteDeps {
  return {
    now: () => new Date(),
    options: (meta) => commandOptions(meta),
  };
}
