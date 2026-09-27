'use client';

import type { SessionDto, SessionListDto, UserDto } from '@shakti/contracts';
import {
  Button,
  EmptyState,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  StatusBadge,
  toast,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { listUserSessions, revokeSession } from '../../actions/admin';
import { describeDevice, formatDateTime } from '../../screens/format';
import { FailureMessage } from '../screens/failure';
import { useCommand, useQuery } from '../screens/use-command';

/** The device of a sign-in in words, such as "Chrome on Android". */
export function useDeviceName() {
  const common = useTranslations('common');
  return (userAgent: string | null) => {
    const { browser, system } = describeDevice(userAgent);
    return common('device', {
      browser: common(`browser.${browser}`),
      system: common(`system.${system}`),
    });
  };
}

/**
 * The sign-ins of one person, newest first (Admin › Team members › Sign-ins). A sign-in that is
 * still live can be ended; an ended one says why, in words.
 */
export function SessionsSheet({ user }: { user: UserDto }) {
  const t = useTranslations('users.sessions');
  const { load, pending, failure } = useQuery<SessionListDto>();
  const [sessions, setSessions] = useState<SessionDto[] | undefined>();
  // The moment the sheet opened: a sign-in past its end is shown as ended.
  const [openedAt] = useState(() => Date.now());

  useEffect(() => {
    load(
      () => listUserSessions({ userId: user.id }),
      (list) => {
        setSessions(list);
      },
    );
  }, [load, user.id]);

  return (
    <>
      <SheetHeader>
        <SheetTitle>{t('title', { name: user.displayName })}</SheetTitle>
        <SheetDescription>{t('intro')}</SheetDescription>
      </SheetHeader>
      <FailureMessage failure={failure} />
      {sessions === undefined ? (
        pending ? (
          <ul className="flex flex-col gap-3" aria-busy>
            {[0, 1, 2].map((i) => (
              <li key={i} className="border-border flex flex-col gap-2 rounded-lg border p-4">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-4 w-3/4" />
              </li>
            ))}
          </ul>
        ) : null
      ) : sessions.length === 0 ? (
        <EmptyState message={t('empty')} />
      ) : (
        <ul className="flex flex-col gap-3">
          {sessions.map((s) => (
            <SessionItem
              key={s.id}
              session={s}
              openedAt={openedAt}
              onEnded={(ended) => {
                setSessions((all) => all?.map((x) => (x.id === ended.id ? ended : x)));
              }}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function SessionItem({
  session,
  openedAt,
  onEnded,
}: {
  session: SessionDto;
  openedAt: number;
  onEnded: (session: SessionDto) => void;
}) {
  const t = useTranslations('users.sessions');
  const deviceName = useDeviceName();
  // One key per shown sign-in: pressing Sign out twice ends it once.
  const { run, pending, failure } = useCommand(revokeSession);
  const device = deviceName(session.userAgent);
  const live = session.revokedAt === null && Date.parse(session.expiresAt) > openedAt;
  const why =
    session.revokedReason === null ? t('reason.timedOut') : t(`reason.${session.revokedReason}`);

  return (
    <li className="border-border bg-surface flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-[510]">{device}</span>
        <StatusBadge tone={live ? 'success' : 'neutral'}>
          {live ? t('active') : t('ended')}
        </StatusBadge>
      </div>
      <div className="text-text-muted flex flex-col gap-1 text-sm">
        <p>{t('started', { time: formatDateTime(session.createdAt) })}</p>
        {session.lastSeenAt === null ? null : (
          <p>{t('lastSeen', { time: formatDateTime(session.lastSeenAt) })}</p>
        )}
        {session.ipAddress === null ? null : (
          <p className="break-all">{t('address', { address: session.ipAddress })}</p>
        )}
        {live || session.revokedAt === null ? null : (
          <p>{t('endedAt', { time: formatDateTime(session.revokedAt) })}</p>
        )}
        {live ? null : <p>{why}</p>}
      </div>
      <FailureMessage failure={failure} />
      {live ? (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          pending={pending}
          aria-label={t('signOutLabel', { device })}
          onClick={() => {
            run({ sessionId: session.id }, () => {
              onEnded({
                ...session,
                revokedAt: new Date().toISOString(),
                revokedReason: 'admin',
              });
              toast.success(t('done'));
            });
          }}
        >
          {t('signOut')}
        </Button>
      ) : null}
    </li>
  );
}
