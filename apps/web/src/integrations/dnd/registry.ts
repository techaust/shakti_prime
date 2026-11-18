import { fixtureDndRegistry, unavailableDndRegistry, type DndRegistry } from '@shakti/domain';
import { hostedRuntime } from '../../auth/deps';

/** The hosted environments that ask the fixture register: the sandboxes, never production. */
const FIXTURE_ENVIRONMENTS: ReadonlySet<string> = new Set(['dev', 'staging']);

/**
 * The DND register this runtime asks before a promotional dial (docs/03-roadmap-appendix/phase2.md
 * §5.2). The scrub source is chosen with the DLT registration in the final phase; until then a
 * developer's machine, CI, dev and staging ask the fixture register, and production, or a hosted
 * runtime that names no known environment, has none (question 13), so a promotional dial whose
 * check has gone stale is refused there and a consented service call is not.
 */
export function dndRegistry(env: NodeJS.ProcessEnv = process.env): DndRegistry {
  if (!hostedRuntime(env)) return fixtureDndRegistry();
  return FIXTURE_ENVIRONMENTS.has(env.BOS_ENVIRONMENT ?? '')
    ? fixtureDndRegistry()
    : unavailableDndRegistry();
}
