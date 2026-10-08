import { isPushServiceEndpoint, type PushTargetDto } from '@shakti/contracts';

/*
 * Browser push (docs/03-roadmap-appendix/phase1.md §8.1): the VAPID keys and the sender behind a small
 * interface, so the notify worker's tests use a stand-in and nothing leaves the machine. Without
 * the three VAPID variables push is off: notices still reach the centre, and nothing is sent.
 */

/** What a push shows: the notice's sentence and the screen it opens. Never a name or a number. */
export interface PushMessage {
  title: string;
  body: string;
  /** A path on this site, opened when the person taps the alert. */
  url: string;
  /** Alerts with the same tag replace each other on the device. */
  tag: string;
}

/** `gone`: the push service says the browser no longer exists (404 or 410); remove it. */
export type PushOutcome = 'ok' | 'gone' | 'failed';

export interface PushSender {
  send(target: PushTargetDto, message: PushMessage): Promise<PushOutcome>;
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  /** A `mailto:` or `https:` address the push services may write to about this sender. */
  subject: string;
}

/** The VAPID keys when all three are set, otherwise nothing: push is then off. */
export function vapidConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): VapidConfig | undefined {
  const publicKey = (env.VAPID_PUBLIC_KEY ?? '').trim();
  const privateKey = (env.VAPID_PRIVATE_KEY ?? '').trim();
  const subject = (env.VAPID_SUBJECT ?? '').trim();
  if (publicKey === '' || privateKey === '' || subject === '') return undefined;
  if (!/^(mailto:|https:\/\/)/.test(subject)) return undefined;
  return { publicKey, privateKey, subject };
}

/** How long one push may take before it counts as failed, and how long a push service keeps it. */
const PUSH_TIMEOUT_MS = 5_000;
const PUSH_TTL_SECONDS = 60 * 60;

/**
 * Sends with `web-push` (loaded on first use, so no other worker carries it). Only an address on a
 * known push service is ever called (`isPushServiceEndpoint`), whatever the database holds.
 */
export function webPushSender(config: VapidConfig): PushSender {
  return {
    async send(target, message) {
      if (!isPushServiceEndpoint(target.endpoint)) return 'gone';
      const webpush = await import('web-push');
      try {
        await webpush.sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          JSON.stringify(message),
          {
            vapidDetails: config,
            TTL: PUSH_TTL_SECONDS,
            timeout: PUSH_TIMEOUT_MS,
            urgency: 'normal',
          },
        );
        return 'ok';
      } catch (error) {
        const status =
          typeof error === 'object' && error !== null && 'statusCode' in error
            ? error.statusCode
            : undefined;
        return status === 404 || status === 410 ? 'gone' : 'failed';
      }
    },
  };
}

/** The app's sender: web push when the VAPID keys are set, none otherwise. */
export function pushSender(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PushSender | undefined {
  const config = vapidConfig(env);
  return config === undefined ? undefined : webPushSender(config);
}

/** A stand-in for tests: records what it would send, answering each address as told. */
export function fakePushSender(answers: Readonly<Record<string, PushOutcome>> = {}): PushSender & {
  sent: { endpoint: string; message: PushMessage }[];
} {
  const sent: { endpoint: string; message: PushMessage }[] = [];
  return {
    sent,
    send(target, message) {
      sent.push({ endpoint: target.endpoint, message });
      return Promise.resolve(answers[target.endpoint] ?? 'ok');
    },
  };
}
