import { z } from 'zod';

/**
 * `POST /webhooks/google/leadform` (docs/API.md §3.4): the Google Ads lead form webhook, shaped as
 * Google's lead form webhook reference describes it. Google signs nothing; the form's key, set
 * per entity in Google Ads, arrives as `google_key` and is compared in constant time before the
 * payload is stored. Unknown keys are kept, since Google adds fields.
 */

/** Standard columns the normaliser maps; custom questions arrive with their own ids. */
export const GOOGLE_LEAD_COLUMNS = [
  'FULL_NAME',
  'FIRST_NAME',
  'LAST_NAME',
  'PHONE_NUMBER',
  'EMAIL',
  'POSTAL_CODE',
  'CITY',
  'REGION',
  'COUNTRY',
  'COMPANY_NAME',
] as const;

const NumericId = z.union([z.number().int(), z.string().regex(/^\d+$/)]);

export const GoogleLeadColumn = z.looseObject({
  column_id: z.string().min(1),
  column_name: z.string().optional(),
  string_value: z.string(),
});

export const GoogleLeadFormWebhook = z.looseObject({
  lead_id: z.string().min(1),
  api_version: z.string().min(1),
  form_id: NumericId,
  campaign_id: NumericId,
  adgroup_id: NumericId.optional(),
  creative_id: NumericId.optional(),
  gcl_id: z.string().optional(),
  google_key: z.string().min(1),
  /** Google's "send test data" button; the worker stores it and creates no lead. */
  is_test: z.boolean().optional(),
  lead_submit_time: z.string().optional(),
  user_column_data: z.array(GoogleLeadColumn).min(1),
});
export type GoogleLeadFormWebhook = z.infer<typeof GoogleLeadFormWebhook>;
