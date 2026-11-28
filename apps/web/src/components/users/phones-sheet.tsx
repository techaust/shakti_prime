'use client';

import type { MobileDeviceDto, MobileDeviceListDto, UserDto } from '@shakti/contracts';
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
import { listMobileDevices, revokeMobileDevice } from '../../actions/field';
import { formatDateTime } from '../../screens/format';
import { FailureMessage } from '../screens/failure';
import { useCommand, useQuery } from '../screens/use-command';

/**
 * The phones one person has signed in to the field app on, newest first (Admin › Team members ›
 * Phones). A phone still signed in can be signed out, a lost or stolen one above all; its next
 * call to the BOS is refused and the app asks for the email and password again.
 */
export function PhonesSheet({ user }: { user: UserDto }) {
  const t = useTranslations('users.phones');
  const { load, pending, failure } = useQuery<MobileDeviceListDto>();
  const [phones, setPhones] = useState<MobileDeviceDto[] | undefined>();

  useEffect(() => {
    load(
      () => listMobileDevices({ userId: user.id }),
      (list) => {
        setPhones(list);
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
      {phones === undefined ? (
        pending ? (
          <ul className="flex flex-col gap-3" aria-busy>
            {[0, 1].map((i) => (
              <li key={i} className="border-border flex flex-col gap-2 rounded-lg border p-4">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-4 w-3/4" />
              </li>
            ))}
          </ul>
        ) : null
      ) : phones.length === 0 ? (
        <EmptyState message={t('empty')} />
      ) : (
        <ul className="flex flex-col gap-3">
          {phones.map((phone) => (
            <PhoneItem
              key={phone.id}
              phone={phone}
              onSignedOut={(ended) => {
                setPhones((all) => all?.map((x) => (x.id === ended.id ? ended : x)));
              }}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function PhoneItem({
  phone,
  onSignedOut,
}: {
  phone: MobileDeviceDto;
  onSignedOut: (phone: MobileDeviceDto) => void;
}) {
  const t = useTranslations('users.phones');
  // One key per shown phone: pressing Sign out twice signs it out once.
  const { run, pending, failure } = useCommand(revokeMobileDevice);
  const name = phone.name ?? t('phone');
  const live = phone.revokedAt === null;

  return (
    <li className="border-border bg-surface flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{name}</span>
        <StatusBadge tone={live ? 'success' : 'neutral'}>
          {live ? t('signedIn') : t('signedOut')}
        </StatusBadge>
      </div>
      <div className="text-text-muted flex flex-col gap-1 text-sm">
        <p>{t('started', { time: formatDateTime(phone.signedInAt) })}</p>
        {phone.lastSeenAt === null ? null : (
          <p>{t('lastUsed', { time: formatDateTime(phone.lastSeenAt) })}</p>
        )}
        <p>{t('version', { version: phone.appVersion })}</p>
        {phone.revokedAt === null ? null : (
          <p>{t('endedAt', { time: formatDateTime(phone.revokedAt) })}</p>
        )}
        {phone.revokedReason === null ? null : <p>{t(`reason.${phone.revokedReason}`)}</p>}
      </div>
      <FailureMessage failure={failure} />
      {live ? (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          pending={pending}
          aria-label={t('signOutLabel', { phone: name })}
          onClick={() => {
            run({ id: phone.id }, (result) => {
              onSignedOut({ ...phone, revokedAt: result.revokedAt, revokedReason: 'revoked' });
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
