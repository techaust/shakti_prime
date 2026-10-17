import { z } from 'zod';

/**
 * `GET /api/v1/health`: liveness only, no dependencies touched. `commit` is the git commit the
 * deployment was built from (Vercel's `VERCEL_GIT_COMMIT_SHA`), null outside Vercel: a release
 * checks with it that staging serves the commit it is about to put on production, and that
 * production serves it afterwards. The repository is public, so the commit tells no one more than
 * the code does.
 */
export const HealthResponse = z
  .object({
    status: z.literal('ok'),
    time: z.iso.datetime(),
    commit: z
      .string()
      .regex(/^[0-9a-f]{40}$/)
      .nullable(),
  })
  .strict();
export type HealthResponse = z.infer<typeof HealthResponse>;

const Check = z.enum(['ok', 'down']);

/**
 * The dependency checks behind `GET /api/v1/health/ready`: the application, reader (when the
 * queries have their own pool) and auth database connections, the shared key-value store (a set and get round trip), the deployment
 * configuration, and the outbox (down when an event has waited longer than the publisher should
 * ever take). They are logged with the request id, never answered: the route is public, and
 * which dependency is down is for the operators, not for whoever asks.
 */
export const ReadyChecks = z
  .object({
    database: Check,
    reader: Check,
    auth_database: Check,
    key_value: Check,
    config: Check,
    outbox: Check,
  })
  .strict();
export type ReadyChecks = z.infer<typeof ReadyChecks>;

/**
 * `GET /api/v1/health/ready`: the overall status only. 200 with this body when every check
 * passes; otherwise 503 with the error envelope (`integration_unavailable`), which names no check.
 */
export const ReadyResponse = z
  .object({
    status: z.literal('ok'),
    time: z.iso.datetime(),
  })
  .strict();
export type ReadyResponse = z.infer<typeof ReadyResponse>;
