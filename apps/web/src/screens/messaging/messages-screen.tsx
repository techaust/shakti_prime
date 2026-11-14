'use client';

import type { ThreadViewDto, WaitingThreadDto, WaitingThreadPageDto } from '@shakti/contracts';
import { Button, EmptyState, StatusBadge } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { listWaitingThreads } from '../../actions/messaging';
import { FailureMessage } from '../../components/screens/failure';
import { useQuery } from '../../components/screens/use-command';
import { formatDateTime, formatPhone } from '../format';
import { WhatsAppThread } from './whatsapp-thread';

/** Whether a key press is typing into a box, which the list's keys leave alone. */
function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/**
 * `/messages` (docs/03-roadmap-appendix/phase2.md §6.1): the WhatsApp chats waiting for a reply that
 * the person may answer, newest customer message first, and the chosen one beside them. J and K
 * move between chats, R goes to the reply box.
 */
export function MessagesScreen({
  initial,
  initialThread,
  companies,
}: {
  initial: WaitingThreadPageDto;
  initialThread?: { entityId: number; threadId: string; view: ThreadViewDto | undefined };
  companies: Record<number, string>;
}) {
  const t = useTranslations('messaging');
  const threadT = useTranslations('messaging.thread');
  const [items, setItems] = useState<WaitingThreadDto[]>(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [chosen, setChosen] = useState<{ entityId: number; threadId: string } | undefined>(
    initialThread ?? (initial.items[0] === undefined
      ? undefined
      : { entityId: initial.items[0].entityId, threadId: initial.items[0].id }),
  );
  const more = useQuery<WaitingThreadPageDto>();
  const reply = useRef<HTMLTextAreaElement>(null);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const key = e.key.toLowerCase();
      const at = items.findIndex((i) => i.id === chosen?.threadId);
      if (key === 'j' || key === 'k') {
        const next = items[key === 'j' ? Math.min(at + 1, items.length - 1) : Math.max(at - 1, 0)];
        if (next === undefined) return;
        e.preventDefault();
        setChosen({ entityId: next.entityId, threadId: next.id });
        rows.current[items.indexOf(next)]?.focus();
      } else if (key === 'r' && reply.current !== null) {
        e.preventDefault();
        reply.current.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [items, chosen]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-text-muted text-sm">{t('keysHelp')}</p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start">
        <section
          aria-labelledby="messages-waiting"
          className="border-border bg-surface flex min-w-0 flex-col gap-2 rounded-lg border p-4"
        >
          <h2 id="messages-waiting" className="text-h3">
            {t('listLabel')}
          </h2>
          {items.length === 0 ? (
            <EmptyState message={t('empty')} />
          ) : (
            <ul className="flex flex-col gap-1">
              {items.map((item, index) => (
                <li key={item.id}>
                  <button
                    ref={(element) => {
                      rows.current[index] = element;
                    }}
                    type="button"
                    aria-current={item.id === chosen?.threadId ? 'true' : undefined}
                    className="hover:bg-surface-2 aria-[current=true]:bg-accent-soft flex w-full flex-col items-start gap-1 rounded-md p-2 text-left"
                    onClick={() => {
                      setChosen({ entityId: item.entityId, threadId: item.id });
                    }}
                  >
                    <span className="font-medium">
                      {item.customerName ?? formatPhone(item.number)}
                    </span>
                    <span className="text-text-muted text-xs">
                      {companies[item.entityId] ?? ''}
                      {item.lastInboundAt === null
                        ? ''
                        : ` · ${t('lastMessage', { time: formatDateTime(item.lastInboundAt) })}`}
                    </span>
                    {item.customerName === null ? (
                      <span className="text-text-muted text-xs">{t('unknownCustomer')}</span>
                    ) : null}
                    {item.handledBy === 'people' ? (
                      <StatusBadge tone="accent">{threadT('people')}</StatusBadge>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <FailureMessage failure={more.failure} />
          {cursor === null ? null : (
            <Button
              variant="secondary"
              className="self-start"
              disabled={more.pending}
              onClick={() => {
                more.load(
                  () => listWaitingThreads({ cursor }),
                  (page) => {
                    setItems((shown) => [...shown, ...page.items]);
                    setCursor(page.nextCursor);
                  },
                );
              }}
            >
              {t('loadMore')}
            </Button>
          )}
        </section>
        <section
          aria-label={threadT('sectionTitle')}
          className="border-border bg-surface flex min-w-0 flex-col gap-3 rounded-lg border p-4"
        >
          {chosen === undefined ? (
            <EmptyState message={t('noChat')} />
          ) : (
            <WhatsAppThread
              key={chosen.threadId}
              ref={reply}
              entityId={chosen.entityId}
              threadId={chosen.threadId}
              initial={
                initialThread?.threadId === chosen.threadId ? initialThread.view : undefined
              }
            />
          )}
        </section>
      </div>
    </div>
  );
}
