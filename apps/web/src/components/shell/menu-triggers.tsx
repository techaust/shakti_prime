'use client';

import { Button, cn, type ButtonProps } from '@shakti/ui';
import { ChevronsUpDown, Layers, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { entityDotClass } from './sidebar-state';

export interface CompanyOption {
  entityId: number;
  label: string;
}

export function Dot({ entityId }: { entityId: number }) {
  return (
    <span aria-hidden className={cn('size-2 shrink-0 rounded-full', entityDotClass(entityId))} />
  );
}

/**
 * The company switcher's button, without the menu: the shell draws it at once, and the menu
 * (Radix) arrives on first use (`deferred-menus.tsx`). The menu's own trigger is this same button.
 */
export function CompanyTriggerButton({
  current,
  ...props
}: { current: CompanyOption | undefined } & ButtonProps) {
  const t = useTranslations('auth.home');
  const shell = useTranslations('shell');
  return (
    <Button
      variant="ghost"
      aria-label={shell('companyMenu', { company: current?.label ?? t('allCompanies') })}
      className="max-w-[min(16rem,45vw)] min-w-0 justify-start px-2"
      {...props}
    >
      {current === undefined ? (
        <Layers aria-hidden className="text-text-muted" />
      ) : (
        <Dot entityId={current.entityId} />
      )}
      <span className="truncate">{current?.label ?? t('allCompanies')}</span>
      <ChevronsUpDown aria-hidden className="text-text-muted" />
    </Button>
  );
}

/** The profile menu's button, likewise drawn at once while the menu arrives on first use. */
export function ProfileTriggerButton(props: ButtonProps) {
  const t = useTranslations('shell');
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t('profileMenu')}
      className="rounded-full"
      {...props}
    >
      <UserRound aria-hidden />
    </Button>
  );
}
