/**
 * What keeps a G2 measure from reaching a vendor or a stranger (review H1 of
 * docs/runs/phase2/g2-measures.md). Pure, so it is unit tested (`safety.test.ts`).
 */

/**
 * Every vendor credential and address the app reads. The measuring server started on this
 * machine runs without them, so its click-to-dial is the simulated provider (Exotel needs its
 * account keys), its mail is the console's, and it reaches no model, speech, storage, queue, cache,
 * error tracker, push service, WhatsApp, Tally or Realtime project, whatever the developer's `.env`
 * holds.
 */
export const VENDOR_CREDENTIALS = [
  'ANTHROPIC_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'FILES_BUCKET',
  'FILES_KMS_KEY_ID',
  'EXOTEL_ACCOUNT_SID',
  'EXOTEL_API_KEY',
  'EXOTEL_API_TOKEN',
  'EXOTEL_SUBDOMAIN',
  'EXOTEL_RECORDING_HOSTS',
  'SENTRY_DSN',
  'NEXT_PUBLIC_SENTRY_DSN',
  'SENTRY_AUTH_TOKEN',
  'SARVAM_API_KEY',
  'SES_FROM',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SCREEN_POP_TRANSPORT',
  'TALLY_URL',
  'TALLY_CONNECTOR_ID',
  'TALLY_CONNECTOR_KEY',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'VOYAGE_API_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_PUBLIC_KEY',
  'VAPID_SUBJECT',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'QSTASH_TOKEN',
  'QSTASH_CURRENT_SIGNING_KEY',
  'QSTASH_NEXT_SIGNING_KEY',
  'QSTASH_URL',
] as const;

/** A copy of `env` with every vendor credential removed and mail sent to the console. */
export function withoutVendorCredentials<E extends Record<string, string | undefined>>(env: E): E {
  const copy: E = { ...env, MAILER: 'log' };
  for (const name of VENDOR_CREDENTIALS) Reflect.deleteProperty(copy, name);
  return copy;
}

export class MeasureRefused extends Error {
  override name = 'MeasureRefused';
}

/**
 * The phone of the lead a dial measure calls. A server started here has no Exotel keys, so its
 * calls go to the simulated provider and a made-up number rings nobody; any other server may place
 * real calls, so it dials only `leadPhone`, a phone the owner's people hold, and never a made-up one.
 */
export function dialLeadPhone(options: {
  serverStartedHere: boolean;
  leadPhone: string | undefined;
  madeUp: () => string;
}): string {
  const given = options.leadPhone?.trim() ?? '';
  if (given !== '') return given;
  if (options.serverStartedHere) return options.madeUp();
  throw new MeasureRefused(
    'a server not started here may place real calls: set G2_DIAL_LEAD_PHONE to a phone your people answer',
  );
}
