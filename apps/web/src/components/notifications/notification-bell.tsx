'use client';

import { Button } from '@shakti/ui';
import { Bell } from 'lucide-react';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { noticeCount } from '../../actions/notifications';
import { BELL_POLL_MS } from '../../screens/notices';

/** The centre is not part of a page's first load: it is fetched when the bell is first pressed. */
const NotificationPanel = dynamic(() =>
  import('./notification-panel').then((m) => m.NotificationPanel),
);

function preloadPanel(): void {
  void import('./notification-panel');
}

/**
 * The bell in the top bar (docs/design/phase1.md §8.1) with the unread count, asked for again
 * every 15 seconds while the page is in view and at once when it comes back into view (the polling
 * of DECISIONS 29-09-2026, until Realtime). Pressing it opens the notification centre.
 */
export function NotificationBell({
  initial,
  pushKey,
}: {
  initial: number | null;
  /** The app's public key for alerts; null when alerts are not set up. */
  pushKey: string | null;
}) {
  const t = useTranslations('notifications');
  const [count, setCount] = useState(initial);
  const [open, setOpen] = useState(false);
  // Mounted from the first opening on, so the centre keeps its list like any dialog.
  const [wanted, setWanted] = useState(false);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const result = await noticeCount();
        if (alive && result.ok) setCount(result.data.unread);
      } catch {
        // A missed read waits for the next one; the count stays as it was.
      }
    };
    const timer = window.setInterval(() => void refresh(), BELL_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const label =
    count === null || count === 0
      ? t('bell')
      : count >= 100
        ? t('bellMoreLabel')
        : t('bellUnread', { count });
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onPointerEnter={preloadPanel}
        onFocus={preloadPanel}
        onClick={() => {
          setWanted(true);
          setOpen(true);
        }}
      >
        <Bell aria-hidden />
        {count === null || count === 0 ? null : (
          // data-dynamic: the count moves as notices arrive, so screenshots mask it.
          <span
            aria-hidden
            data-dynamic
            data-testid="bell-count"
            className="bg-accent text-accent-fg absolute top-1 right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-xs leading-none font-medium"
          >
            {count >= 100 ? t('bellMore') : count}
          </span>
        )}
      </Button>
      {wanted ? (
        <NotificationPanel
          open={open}
          pushKey={pushKey}
          onOpenChange={setOpen}
          onUnreadChange={(change) => {
            setCount((current) => (current === null ? current : change(current)));
          }}
        />
      ) : null}
    </>
  );
}
