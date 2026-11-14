'use client';

import type { WaitingThreadDto } from '@shakti/contracts';
import { EmptyState, Skeleton } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { listAccountThreads } from '../../actions/messaging';
import { FailureMessage } from '../../components/screens/failure';
import { useQuery } from '../../components/screens/use-command';
import { formatPhone } from '../format';
import { WhatsAppThread } from './whatsapp-thread';

/**
 * A customer's WhatsApp chats in one company (docs/03-roadmap-appendix/phase2.md §6.1), on Account
 * 360 and beside the lead in the Converting workspace: the chat of their newest message, and a
 * choice of the others when they wrote from more than one number.
 */
export function WhatsAppChats({ entityId, accountId }: { entityId: number; accountId: string }) {
  const t = useTranslations('messaging.thread');
  const [threads, setThreads] = useState<WaitingThreadDto[] | undefined>();
  const [chosen, setChosen] = useState<string | undefined>();
  const read = useQuery<WaitingThreadDto[]>();

  useEffect(() => {
    read.load(() => listAccountThreads({ entityId, accountId }), setThreads);
  }, [read, entityId, accountId]);

  const current = chosen ?? threads?.[0]?.id;
  return (
    <section
      aria-labelledby="whatsapp-chats"
      className="border-border bg-surface flex min-w-0 flex-col gap-3 rounded-lg border p-4"
    >
      <h2 id="whatsapp-chats" className="text-h3">
        {t('sectionTitle')}
      </h2>
      <FailureMessage failure={read.failure} />
      {threads === undefined ? (
        read.failure === undefined ? <Skeleton className="h-24" /> : null
      ) : threads.length === 0 || current === undefined ? (
        <EmptyState message={t('none')} />
      ) : (
        <>
          {threads.length > 1 ? (
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('messagesLabel')}>
              {threads.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  aria-pressed={thread.id === current}
                  className="border-border h-control rounded-md border px-3 text-sm aria-pressed:border-accent"
                  onClick={() => {
                    setChosen(thread.id);
                  }}
                >
                  {formatPhone(thread.number)}
                </button>
              ))}
            </div>
          ) : null}
          <WhatsAppThread key={current} entityId={entityId} threadId={current} />
        </>
      )}
    </section>
  );
}
