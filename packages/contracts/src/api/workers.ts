import { z } from 'zod';
import { EntityIdSchema, IdSchema } from '../ids';
import { ImportJobStateSchema } from '../imports/enums';

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

/**
 * `POST /api/v1/workers/imports/commit`: the job to commit and whose job it is. Only the app
 * sends it, through QStash, after `imports.job.commit`; the worker acts as that person.
 */
export const ImportCommitWorkerBody = z
  .object({ jobId: IdSchema, entityId: EntityIdSchema, userId: IdSchema })
  .strict();
export type ImportCommitWorkerBody = z.infer<typeof ImportCommitWorkerBody>;

/** What one worker run did: the batches it committed and where the job stands afterwards. */
export const ImportCommitWorkerResponse = z
  .object({
    jobId: IdSchema,
    state: ImportJobStateSchema,
    batches: Count,
    committedRows: Count,
  })
  .strict();
export type ImportCommitWorkerResponse = z.infer<typeof ImportCommitWorkerResponse>;
