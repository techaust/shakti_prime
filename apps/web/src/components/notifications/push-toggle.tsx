'use client';

import { Button, toast } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { subscribePush, unsubscribePush } from '../../actions/notifications';
import { FailureMessage } from '../screens/failure';
import { settle } from '../screens/settle';
import type { CommandFailure } from '../screens/use-command';

/** The service worker that shows alerts; a static file the proxy and the CSP allow. */
export const PUSH_WORKER_PATH = '/push-sw.js';

type PushState = 'checking' | 'unavailable' | 'unsupported' | 'blocked' | 'on' | 'off';

/** The app's public VAPID key as the browser's push manager takes it. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64url}${'='.repeat((4 - (base64url.length % 4)) % 4)}`;
  const raw = atob(padded.replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function supported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration('/');
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/**
 * Alerts on this browser (docs/03-roadmap-appendix/phase1.md §8.1): whether this browser receives the person's
 * pushes, and the button that turns them on or off. Nothing is asked of the browser until the
 * person taps: the service worker is registered and permission requested only then, never when a
 * page loads. Without the app's VAPID key, alerts are not set up and the section says so.
 */
export function PushToggle({ publicKey }: { publicKey: string | null }) {
  const t = useTranslations('notifications.settings');
  const [state, setState] = useState<PushState>('checking');
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<CommandFailure | undefined>();

  useEffect(() => {
    let alive = true;
    const settleState = (next: PushState) => {
      if (alive) setState(next);
    };
    if (publicKey === null) settleState('unavailable');
    else if (!supported()) settleState('unsupported');
    else if (Notification.permission === 'denied') settleState('blocked');
    else {
      currentSubscription().then(
        (subscription) => {
          settleState(subscription === null ? 'off' : 'on');
        },
        () => {
          settleState('off');
        },
      );
    }
    return () => {
      alive = false;
    };
  }, [publicKey]);

  function failed(error: string) {
    setFailure((previous) => ({ error, attempt: (previous?.attempt ?? 0) + 1 }));
  }

  function turnOn() {
    if (publicKey === null) return;
    startTransition(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          setState(permission === 'denied' ? 'blocked' : 'off');
          return;
        }
        const registration = await navigator.serviceWorker.register(PUSH_WORKER_PATH, {
          scope: '/',
        });
        await navigator.serviceWorker.ready;
        const subscription =
          (await registration.pushManager.getSubscription()) ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: keyBytes(publicKey),
          }));
        const json = subscription.toJSON();
        const result = await settle(() =>
          subscribePush(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
              userAgent: navigator.userAgent.slice(0, 300),
            },
            crypto.randomUUID(),
          ),
        );
        if (!result.ok) {
          await subscription.unsubscribe();
          failed(result.error);
          return;
        }
        setFailure(undefined);
        setState('on');
        toast.success(t('pushOnDone'));
      } catch {
        failed('push_failed');
      }
    });
  }

  function turnOff() {
    startTransition(async () => {
      try {
        const subscription = await currentSubscription();
        if (subscription !== null) {
          const result = await settle(() =>
            unsubscribePush({ endpoint: subscription.endpoint }, crypto.randomUUID()),
          );
          if (!result.ok) {
            failed(result.error);
            return;
          }
          await subscription.unsubscribe();
        }
        setFailure(undefined);
        setState('off');
        toast.success(t('pushOffDone'));
      } catch {
        failed('push_failed');
      }
    });
  }

  const message =
    state === 'unavailable'
      ? t('pushUnavailable')
      : state === 'unsupported'
        ? t('browserUnsupported')
        : state === 'blocked'
          ? t('browserBlocked')
          : state === 'on'
            ? t('browserOn')
            : state === 'off'
              ? t('browserOff')
              : null;
  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="text-text text-sm">
        {message}
      </p>
      {state === 'on' ? (
        <Button variant="secondary" className="self-start" pending={pending} onClick={turnOff}>
          {t('turnOffPush')}
        </Button>
      ) : state === 'off' || state === 'blocked' ? (
        <Button className="self-start" pending={pending} onClick={turnOn}>
          {t('turnOnPush')}
        </Button>
      ) : null}
      <FailureMessage failure={failure} />
    </div>
  );
}
