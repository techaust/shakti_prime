'use client';

import type { ScreenPopDto } from '@shakti/contracts';
import { Button } from '@shakti/ui';
import { PhoneIncoming, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useEffectEvent, useId, useState } from 'react';
import { ringingTicket } from '../../actions/screen-pop';
import { handOverPhone } from '../../calls/new-lead-phone';
import { askRinging, startScreenPop, type PopHost, type Ticket } from '../../calls/pop-transport';

/** What the shell knows of the person and the deployment, for the screen-pop. */
export interface ScreenPopSettings {
  ticket: Ticket;
  /** The Realtime project's address and publishable key when Realtime is the transport. */
  realtime: { url: string; key: string } | null;
  /** The companies the switcher shows now: a call of another is shown but nothing is opened. */
  viewCompanies: readonly number[];
  mayAddLead: boolean;
  mayOpenCustomers: boolean;
}

const browserHost: PopHost = {
  now: () => Date.now(),
  visible: () => document.visibilityState === 'visible',
  onVisibility: (listener) => {
    document.addEventListener('visibilitychange', listener);
    return () => {
      document.removeEventListener('visibilitychange', listener);
    };
  },
  setTimer: (run, ms) => window.setTimeout(run, ms),
  clearTimer: (timer) => {
    window.clearTimeout(timer as number);
  },
};

async function renewTicket(): Promise<Ticket | undefined> {
  const result = await ringingTicket();
  return result.ok ? result.data : undefined;
}

const customerHref = (accountId: string, entityId: number) =>
  `/customers/${accountId}?company=${String(entityId)}`;

/** What the pop did on arrival: the customer's page or the new-lead form opened, or nothing. */
type Opened = 'customer' | 'newLead' | null;

/**
 * The screen-pop (docs/03-roadmap-appendix/phase2.md §7.4, PRD TEL-05) for a person who places
 * calls: while their page is in view it learns of a call the IVR rings for them
 * (`startScreenPop`, by the poll or Realtime) and opens the matched customer's page, lists the
 * customers when several share the number, or opens the New lead form with the number filled in.
 * The card says which, with the number's last four digits only, until the person closes it or the
 * next call replaces it. Nothing opens for a call of a company the switcher does not show.
 */
export function ScreenPop({
  settings,
  companies,
}: {
  settings: ScreenPopSettings;
  companies: readonly { entityId: number; label: string }[];
}) {
  const t = useTranslations('shell.incomingCall');
  const router = useRouter();
  const heading = useId();
  const [shown, setShown] = useState<{ pop: ScreenPopDto; opened: Opened } | null>(null);

  const arrive = useEffectEvent((pop: ScreenPopDto) => {
    const inView = settings.viewCompanies.includes(pop.entityId);
    const [only] = pop.customers;
    let opened: Opened = null;
    if (inView && pop.customers.length === 1 && only !== undefined && settings.mayOpenCustomers) {
      router.push(customerHref(only.accountId, pop.entityId));
      opened = 'customer';
    } else if (inView && pop.newLeadPhone !== null && settings.mayAddLead) {
      handOverPhone(pop.newLeadPhone);
      router.push(`/leads/new?company=${String(pop.entityId)}`);
      opened = 'newLead';
    }
    setShown({ pop, opened });
  });

  const { ticket, realtime } = settings;
  useEffect(() => {
    let stop: (() => void) | undefined;
    let ended = false;
    const start = (channel?: Parameters<typeof startScreenPop>[0]['channel']) => {
      if (ended) return;
      stop = startScreenPop({
        ticket,
        renewTicket,
        ask: (value) => askRinging(value),
        onPop: arrive,
        host: browserHost,
        ...(channel === undefined ? {} : { channel }),
      });
    };
    if (realtime === null) {
      start();
    } else {
      // The Realtime client loads only where Realtime is the transport.
      void import('../../calls/realtime-channel')
        .then((m) => {
          start(m.realtimeWakeChannel(realtime.url, realtime.key, m.browserChannelHost()));
        })
        .catch(() => {
          start();
        });
    }
    return () => {
      ended = true;
      stop?.();
    };
    // A new ticket from the server (a refreshed layout) starts afresh; renewals happen inside.
  }, [ticket, realtime]);

  if (shown === null) return null;
  const { pop, opened } = shown;
  const company = companies.find((c) => c.entityId === pop.entityId)?.label;
  const inView = settings.viewCompanies.includes(pop.entityId);
  const [only] = pop.customers;
  const message =
    pop.customers.length === 1 && only !== undefined
      ? t(opened === 'customer' ? 'oneOpened' : 'one', { name: only.name })
      : pop.customers.length > 1
        ? t('several', { count: pop.customers.length })
        : pop.newLeadPhone !== null
          ? t(opened === 'newLead' ? 'newOpened' : 'newNumber', { last4: pop.phoneLast4 })
          : t('colleague', { last4: pop.phoneLast4 });

  return (
    <section
      aria-labelledby={heading}
      // Under the top bar on the right on a wide screen, where nothing of the shell sits and the
      // toasts (bottom right) never cover it; at the foot on a phone, where the toasts are on top.
      className="bg-surface border-border-strong shadow-2 fixed inset-x-4 bottom-4 z-40 flex flex-col gap-3 rounded-lg border p-4 md:inset-x-auto md:top-16 md:right-6 md:bottom-auto md:w-96"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="bg-accent-soft text-accent-text inline-flex size-8 shrink-0 items-center justify-center rounded-full"
        >
          <PhoneIncoming className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id={heading} className="text-h3">
            {t('title')}
          </h2>
          {companies.length > 1 && company !== undefined ? (
            <p className="text-text-muted text-sm">{t('company', { company })}</p>
          ) : null}
          {/* Said at once by a screen reader, as a ringing phone would be heard. */}
          <p role="alert" className="text-sm">
            {message}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('closeLabel')}
          title={t('closeLabel')}
          onClick={() => {
            setShown(null);
          }}
          className="-mt-1 -mr-1 shrink-0"
        >
          <X aria-hidden />
        </Button>
      </div>
      {!inView && company !== undefined ? (
        <p className="text-text-muted text-sm">{t('otherCompany', { company })}</p>
      ) : null}
      {pop.customers.length > 1 ? (
        <ul aria-label={t('severalList')} className="flex flex-col gap-1">
          {pop.customers.map((c) => (
            <li key={c.accountId} className="text-sm">
              {inView && settings.mayOpenCustomers ? (
                <Link
                  href={customerHref(c.accountId, pop.entityId)}
                  className="text-accent-text inline-flex min-h-8 items-center underline-offset-2 hover:underline"
                >
                  {c.name}
                </Link>
              ) : (
                c.name
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {inView &&
      opened === null &&
      only !== undefined &&
      pop.customers.length === 1 &&
      settings.mayOpenCustomers ? (
        <Button asChild variant="secondary" size="sm" className="self-start">
          <Link href={customerHref(only.accountId, pop.entityId)}>{t('openCustomer')}</Link>
        </Button>
      ) : null}
      {inView && opened === null && pop.newLeadPhone !== null && settings.mayAddLead ? (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() => {
            if (pop.newLeadPhone !== null) handOverPhone(pop.newLeadPhone);
            router.push(`/leads/new?company=${String(pop.entityId)}`);
            setShown({ pop, opened: 'newLead' });
          }}
        >
          {t('addAsNewLead')}
        </Button>
      ) : null}
    </section>
  );
}
