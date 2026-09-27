import { z } from 'zod';

const Count = z.number().int().min(0);

/**
 * `POST /api/v1/workers/outbox/publish`: what one publisher run did (docs/design/backend-weeks-3-5.md
 * §4.2). `skipped` counts events no worker listens to yet, marked delivered without sending.
 */
export const OutboxPublishResponse = z
  .object({
    claimed: Count,
    published: Count,
    skipped: Count,
    failed: Count,
    deadLettered: Count,
  })
  .strict();
export type OutboxPublishResponse = z.infer<typeof OutboxPublishResponse>;
