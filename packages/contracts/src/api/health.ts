import { z } from 'zod';

/** `GET /api/v1/health`: liveness only, no dependencies touched. */
export const HealthResponse = z.object({
  status: z.literal('ok'),
  time: z.iso.datetime(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

const Check = z.enum(['ok', 'down']);

/**
 * `GET /api/v1/health/ready`: dependency checks. The application and auth database connections,
 * the shared key-value store (a set and get round trip) and the deployment configuration.
 * QStash joins the list with the outbox publisher.
 */
export const ReadyChecks = z
  .object({ database: Check, auth_database: Check, key_value: Check, config: Check })
  .strict();
export type ReadyChecks = z.infer<typeof ReadyChecks>;

export const ReadyResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: ReadyChecks,
  time: z.iso.datetime(),
});
export type ReadyResponse = z.infer<typeof ReadyResponse>;
