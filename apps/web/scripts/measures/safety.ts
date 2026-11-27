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

/**
 * The variables of `.env.example` whose names look like a vendor's secret (a `_KEY`, `_SECRET`,
 * `_TOKEN` or `_PASSWORD` ending, or a vendor's prefix) and that the measures keep on purpose,
 * because none of them lets a measure reach a vendor. `safety.test.ts` fails on any such variable
 * that is neither here nor in `VENDOR_CREDENTIALS`, so a new vendor key is sorted when it is added.
 */
export const KEPT_LOOKALIKES = {
  /** The local database's role passwords: the server needs them to reach its own Postgres. */
  databaseRoles: [
    'APP_USER_PASSWORD',
    'APP_READER_PASSWORD',
    'AUTH_SERVICE_PASSWORD',
    'OUTBOX_PUBLISHER_PASSWORD',
    'WEBHOOK_RECEIVER_PASSWORD',
  ],
  /** The app's own keys, which it signs or seals with and sends to no one. */
  appKeys: [
    'BETTER_AUTH_SECRET',
    'BOS_JWT_CURRENT_KEY',
    'BOS_JWT_NEXT_KEY',
    'FIELD_ENCRYPTION_KEY',
    // F1: the field app's token pair, which the server signs and checks the app's tokens with.
    'MOBILE_JWT_PRIVATE_KEY',
    'MOBILE_JWT_PUBLIC_KEY',
  ],
  /** Sign-in needs them; a local run holds Cloudflare's test keys, which a hosted runtime refuses. */
  signIn: ['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'],
  /**
   * Phrases that only check what reaches the server (webhooks, a quote's Accept button). The server
   * started here is given its own (`MEASURE_SERVER_ENV`: LiveKit's are accepted by no project, at an
   * address that does not exist), and the load measure signs its deliveries with them.
   */
  serverGivenPhrases: [
    'EXOTEL_CALLBACK_SECRET',
    'EXOTEL_INCOMING_SECRET',
    'GOOGLE_LEADFORM_KEY',
    'META_LEADGEN_APP_SECRET',
    'META_LEADGEN_VERIFY_TOKEN',
    'WHATSAPP_APP_SECRET',
    'WHATSAPP_VERIFY_TOKEN',
    'WHATSAPP_BUTTON_SECRET',
    'LIVEKIT_API_KEY',
    'LIVEKIT_API_SECRET',
    'LIVEKIT_URL',
  ],
  /** Settings that hold no secret and no address. */
  settings: [
    'AWS_REGION',
    'SARVAM_STT_MODEL',
    'SARVAM_TTS_MODEL',
    'SARVAM_TTS_SPEAKER',
    'SENTRY_ORG',
    'SENTRY_PROJECT',
    'WHATSAPP_GRAPH_VERSION',
    'WHATSAPP_MEDIA_ORPHAN_SWEEP',
    'WHATSAPP_MEDIA_RETENTION',
  ],
} as const satisfies Record<string, readonly string[]>;

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
