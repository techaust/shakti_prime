import { z } from 'zod';
import { ConsentPurposeSchema, SegmentSchema } from '../crm/enums';
import { PhoneInputSchema } from '../crm/phone';
import { IdSchema } from '../ids';

/**
 * Website and partner ingest (docs/06-api.md §3.3). Each entity's site holds its own ingest key,
 * sent in `X-Ingest-Key`, and every form carries a Turnstile answer. A lead goes through the same
 * normalisation and dedupe as every other source.
 */

/** An entity's short code, as `entities.code` holds it. */
export const EntityCodeSchema = z.string().regex(/^[A-Z]{2,10}$/);

const Utm = z
  .object({
    source: z.string().trim().min(1).max(100).optional(),
    medium: z.string().trim().min(1).max(100).optional(),
    campaign: z.string().trim().min(1).max(150).optional(),
    term: z.string().trim().min(1).max(150).optional(),
    content: z.string().trim().min(1).max(150).optional(),
  })
  .strict();

/** `POST /ingest/leads`. The phone is normalised to E.164 on parse. */
export const IngestLeadRequest = z
  .object({
    entityCode: EntityCodeSchema,
    name: z.string().trim().min(2).max(120),
    phone: PhoneInputSchema,
    pin: z
      .string()
      .trim()
      .regex(/^[1-9][0-9]{5}$/)
      .optional(),
    segment: SegmentSchema.optional(),
    message: z.string().trim().max(1000).optional(),
    utm: Utm.optional(),
    /** The consent wording exactly as the form showed it, and when the person ticked it. */
    consent: z
      .object({
        purpose: ConsentPurposeSchema,
        text: z.string().trim().min(10).max(2000),
        givenAt: z.iso.datetime(),
      })
      .strict(),
    turnstileToken: z.string().min(1).max(2048),
  })
  .strict();
export type IngestLeadRequest = z.infer<typeof IngestLeadRequest>;

/** `created` opened a new lead; `attached` added the enquiry to a customer the group knows. */
export const IngestLeadResponse = z
  .object({
    leadId: IdSchema,
    outcome: z.enum(['created', 'attached']),
  })
  .strict();
export type IngestLeadResponse = z.infer<typeof IngestLeadResponse>;

/** `GET /ingest/health`: the key works, for which entity, and how much of the minute is left. */
export const IngestHealthResponse = z
  .object({
    keyValid: z.literal(true),
    entityCode: EntityCodeSchema,
    rateLimit: z
      .object({
        limit: z.number().int().positive(),
        remaining: z.number().int().min(0),
        resetAt: z.iso.datetime(),
      })
      .strict(),
  })
  .strict();
export type IngestHealthResponse = z.infer<typeof IngestHealthResponse>;
