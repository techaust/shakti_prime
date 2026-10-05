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

/**
 * `POST /api/v1/workers/crm/rescore`: the nightly rescoring of open and nurture leads (CRM-06).
 * The schedule sends `{}`, every company from its first lead; a run that ran out of time hands the
 * rest to the next run with the company and the last lead it reached, and the night's date
 * (`runDate`, the UTC date the night's first call started), which names the night in the
 * hand-over's deduplication id.
 */
export const LeadRescoreWorkerBody = z
  .object({
    entityId: EntityIdSchema.optional(),
    afterId: IdSchema.optional(),
    runDate: z.iso.date().optional(),
  })
  .strict()
  .refine((b) => b.afterId === undefined || b.entityId !== undefined, {
    message: 'a lead to start after belongs to a company',
    path: ['afterId'],
  });
export type LeadRescoreWorkerBody = z.infer<typeof LeadRescoreWorkerBody>;

/** What one rescoring run did: the batches it ran, the leads that changed, and whether it is done. */
export const LeadRescoreWorkerResponse = z
  .object({ batches: Count, rescored: Count, done: z.boolean() })
  .strict();
export type LeadRescoreWorkerResponse = z.infer<typeof LeadRescoreWorkerResponse>;

/**
 * `POST /api/v1/workers/crm/duplicates`: the nightly search for duplicate customers and leads
 * (CRM-03). The schedule sends `{}`, every company from its first customer; a run that ran out of
 * time hands the rest to the next run with the company and the last customer it reached, and the
 * night's date (`runDate`), which names the night in the hand-over's deduplication id.
 */
export const DuplicateScanWorkerBody = z
  .object({
    entityId: EntityIdSchema.optional(),
    afterId: IdSchema.optional(),
    runDate: z.iso.date().optional(),
  })
  .strict()
  .refine((b) => b.afterId === undefined || b.entityId !== undefined, {
    message: 'a customer to start after belongs to a company',
    path: ['afterId'],
  });
export type DuplicateScanWorkerBody = z.infer<typeof DuplicateScanWorkerBody>;

/** What one search run did: the batches it ran, the candidates it found, and whether it is done. */
export const DuplicateScanWorkerResponse = z
  .object({ batches: Count, found: Count, done: z.boolean() })
  .strict();
export type DuplicateScanWorkerResponse = z.infer<typeof DuplicateScanWorkerResponse>;
