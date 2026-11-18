/**
 * The settings the journeys' production server starts with, shared by playwright.config.ts's own
 * server and e2e:snap's (snap-in-linux.ts), so the two serve the same pages: a local production
 * run (apps/web/src/auth/deps.ts), the stand-in AI transport, so the Knowledge Vault indexes and
 * searches without a key, and LiveKit named with phrases no service accepts, so /voice offers a
 * talk; its journey answers the session route itself and puts a fake room in the browser
 * (voice.spec.ts); and a phrase for a WhatsApp quote's Accept button, so a quote can be sent on
 * WhatsApp (whatsapp-quotes.spec.ts). CI's journeys job sets the same values (ci.yml).
 */
export const JOURNEY_SERVER_ENV = {
  BOS_ENVIRONMENT: 'local',
  AI_TRANSPORT: 'fake',
  LIVEKIT_URL: 'wss://livekit.journeys.invalid',
  LIVEKIT_API_KEY: 'journeys livekit key',
  LIVEKIT_API_SECRET: 'journeys livekit secret, accepted by no livekit project',
  WHATSAPP_BUTTON_SECRET: 'journeys whatsapp button phrase, accepted nowhere else',
} as const;
