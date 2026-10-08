'use client';

import type { NoticeDto, NoticePageDto } from '@shakti/contracts';
import {
  Button,
  EmptyState,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  toast,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listNotices, markAllNoticesRead, markNoticesRead } from '../../actions/notifications';
import { noticeHref } from '../../screens/notices';
import { DateTime } from '../date-time';
import { PushToggle } from './push-toggle';
import { FailureMessage } from '../screens/failure';
import { useCommand, useQuery } from '../screens/use-command';

const PAGE_SIZE = 20;

/**
 * The notification centre (docs/03-roadmap-appendix/phase1.md §8.1), a panel from the right: the caller's
 * notices in the companies being viewed, newest first, a page at a time. Opening a notice takes
 * the person to the screen they act on and marks it read; each unread notice can be marked read
 * where it is, and all of them at once. Loaded when the bell is first pressed; the list is read
 * afresh each time it opens.
 */
export function NotificationPanel({
  open,
  onOpenChange,
  onUnreadChange,
  pushKey,
}: {
  /** The app's public key for alerts; null when alerts are not set up. */
  pushKey: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tells the bell how its count changed. */
  onUnreadChange: (change: (count: number) => number) => void;
}) {
  const t = useTranslations('notifications');
  const [page, setPage] = useState<NoticePageDto | undefined>();
  const first = useQuery<NoticePageDto>();
  const more = useQuery<NoticePageDto>();
  const readAll = useCommand(markAllNoticesRead);
  const { load } = first;

  useEffect(() => {
    if (!open) return;
    load(
      () => listNotices({ limit: PAGE_SIZE }),
      (data) => {
        setPage(data);
      },
    );
  }, [open, load]);

  const items = page?.items ?? [];
  const unread = items.filter((n) => n.readAt === null).length;

  function markedRead(ids: readonly string[]) {
    const now = new Date().toISOString();
    setPage((current) =>
      current === undefined
        ? current
        : {
            ...current,
            items: current.items.map((n) =>
              ids.includes(n.id) && n.readAt === null ? { ...n, readAt: now } : n,
            ),
          },
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        closeLabel={t('close')}
        className="flex w-full max-w-md flex-col gap-4 p-4"
      >
        <SheetHeader>
          <SheetTitle>{t('panelTitle')}</SheetTitle>
          <SheetDescription>{t('panelIntro')}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="secondary"
            disabled={unread === 0}
            pending={readAll.pending}
            onClick={() => {
              readAll.run(undefined, () => {
                markedRead(items.map((n) => n.id));
                onUnreadChange(() => 0);
                toast.success(t('allRead'));
              });
            }}
          >
            {t('markAllRead')}
          </Button>
          <Link
            href="/settings/notifications"
            className="text-accent-text text-sm underline-offset-4 hover:underline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t('openSettings')}
          </Link>
        </div>
        <FailureMessage failure={first.failure ?? readAll.failure ?? more.failure} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {page === undefined ? (
            first.pending ? (
              <div className="flex flex-col gap-2" aria-busy="true" aria-label={t('loading')}>
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            ) : null
          ) : items.length === 0 ? (
            <EmptyState message={t('empty')} />
          ) : (
            <ul aria-label={t('panelTitle')} className="flex flex-col gap-2">
              {items.map((notice) => (
                <NoticeRow
                  key={notice.id}
                  notice={notice}
                  onOpen={() => {
                    onOpenChange(false);
                  }}
                  onRead={() => {
                    markedRead([notice.id]);
                    onUnreadChange((count) => Math.max(0, count - 1));
                  }}
                />
              ))}
            </ul>
          )}
          {page?.nextCursor == null ? null : (
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              pending={more.pending}
              onClick={() => {
                const cursor = page.nextCursor ?? undefined;
                more.load(
                  () => listNotices({ limit: PAGE_SIZE, cursor }),
                  (next) => {
                    setPage((current) => ({
                      items: [
                        ...(current?.items ?? []),
                        ...next.items.filter((n) => !current?.items.some((c) => c.id === n.id)),
                      ],
                      nextCursor: next.nextCursor,
                    }));
                  },
                );
              }}
            >
              {t('loadMore')}
            </Button>
          )}
        </div>
        <section className="border-border flex flex-col gap-2 border-t pt-3">
          <h3 className="text-sm font-medium">{t('settings.browserHeading')}</h3>
          <PushToggle publicKey={pushKey} />
        </section>
      </SheetContent>
    </Sheet>
  );
}

/** One notice: its sentence, the customer or quote it is about, when, and whether it was read. */
function NoticeRow({
  notice,
  onOpen,
  onRead,
}: {
  notice: NoticeDto;
  onOpen: () => void;
  onRead: () => void;
}) {
  const t = useTranslations('notifications');
  const mark = useCommand(markNoticesRead);
  const unread = notice.readAt === null;
  const href = noticeHref(notice);
  const detail =
    notice.orderNo !== null
      ? t('orderLine', { orderNo: notice.orderNo })
      : notice.quoteNo !== null
        ? t('quoteLine', { quoteNo: notice.quoteNo })
        : notice.customerName;

  function read() {
    if (!unread || mark.pending) return;
    mark.run({ ids: [notice.id] }, onRead);
  }

  return (
    <li
      className={
        unread
          ? 'border-accent bg-surface flex flex-col gap-1 rounded-md border p-3'
          : 'border-border bg-surface flex flex-col gap-1 rounded-md border p-3'
      }
    >
      <Link
        href={href}
        className="text-text font-medium underline-offset-4 hover:underline"
        onClick={() => {
          read();
          onOpen();
        }}
      >
        {t(`types.${notice.type}`)}
      </Link>
      {detail === null ? null : <p className="text-text text-sm">{detail}</p>}
      <p className="text-text-muted flex flex-wrap items-center gap-x-2 text-xs">
        <DateTime value={notice.createdAt} />
        {unread ? <span>{t('unread')}</span> : null}
      </p>
      {unread ? (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          aria-label={t('markReadLabel', { notice: t(`types.${notice.type}`) })}
          pending={mark.pending}
          onClick={read}
        >
          {t('markRead')}
        </Button>
      ) : null}
      <FailureMessage failure={mark.failure} />
    </li>
  );
}
