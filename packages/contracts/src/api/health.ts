import { z } from 'zod';

/** `GET /api/v1/health`: liveness only, no dependencies touched. */
export const HealthResponse = z.object({
  status: z.literal('ok'),
  time: z.iso.datetime(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** `GET /api/v1/health/ready`: dependency checks. Redis and QStash join the list in week 3. */
export const ReadyResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.object({
    database: z.enum(['ok', 'down']),
  }),
  time: z.iso.datetime(),
});
export type ReadyResponse = z.infer<typeof ReadyResponse>;
