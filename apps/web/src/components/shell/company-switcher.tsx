'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  toast,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { useTransition } from 'react';
import { switchEntity } from '../../actions/auth';
import type { ErrorKey } from '../../i18n/types';
import { CompanyTriggerButton, Dot, type CompanyOption } from './menu-triggers';

const ALL = 'all';

/**
 * The company switcher in the top bar (DESIGN.md §5): All companies or one company the person
 * holds a role in. The choice is a cookie set by `switchEntity`, which brings the person back to
 * the screen they were on, now narrowed to that company.
 */
export function CompanySwitcher({
  companies,
  active,
  defaultOpen = false,
}: {
  companies: readonly CompanyOption[];
  active: number | undefined;
  /** Open at once: the top bar mounts the menu on the press that asked for it. */
  defaultOpen?: boolean;
}) {
  const t = useTranslations('auth.home');
  const errors = useTranslations('errors');
  const app = useTranslations('app');
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const current = companies.find((c) => c.entityId === active);

  function choose(value: string) {
    if (value === (current === undefined ? ALL : String(current.entityId))) return;
    const form = new FormData();
    form.set('entityId', value === ALL ? '' : value);
    form.set('returnTo', pathname);
    startTransition(async () => {
      const result = await switchEntity(form);
      if (result.error === undefined) return;
      const key = result.error as ErrorKey;
      toast.error(errors(errors.has(key) ? key : 'internal'), {
        ...(result.reference === undefined
          ? {}
          : { description: app('reference', { reference: result.reference }) }),
      });
    });
  }

  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger asChild>
        <CompanyTriggerButton current={current} pending={pending} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>{t('companies')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={current === undefined ? ALL : String(current.entityId)}
          onValueChange={choose}
        >
          <DropdownMenuRadioItem value={ALL}>{t('allCompanies')}</DropdownMenuRadioItem>
          {companies.map((c) => (
            <DropdownMenuRadioItem key={c.entityId} value={String(c.entityId)}>
              <Dot entityId={c.entityId} />
              <span className="truncate">{c.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
