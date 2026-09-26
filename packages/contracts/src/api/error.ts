import { z } from 'zod';
import { ErrorCodeSchema } from '../errors';

/** The one error envelope for `/api/v1` (docs/API.md §1). `message` is plain language from the catalogue. */
export const ErrorEnvelope = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string(),
  }),
});

export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;
