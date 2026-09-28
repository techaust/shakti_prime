'use client';

import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  toast,
} from '@shakti/ui';
import { ChevronsUpDown, Layers } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { useTransition } from 'react';
import { switchEntity } from '../../actions/auth';
import type { ErrorKey } from '../../i18n/types';
import { entityDotClass } from './sidebar-state';

export interface CompanyOption {
  entityId: number;
  label: string;
}

const ALL = 'all';

function Dot({ entityId }: { entityId: number }) {
  return (
    <span aria-hidden className={cn('size-2 shrink-0 rounded-full', entityDotClass(entityId))} />
  );
}

/**
 * The company switcher in the top bar (DESIGN.md §5): All companies or one company the person
 * holds a role in. The choice is a cookie set by `switchEntity`, which brings the person back to
 * the screen they were on, now narrowed to that company.
 */
export function CompanySwitcher({
  companies,
  active,
}: {
  companies: readonly CompanyOption[];
  active: number | undefined;
}) {
  const t = useTranslations('auth.home');
  const shell = useTranslations('shell');
  const errors = useTranslations('errors');
  const app = useTranslations('app');
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const current = companies.find((c) => c.entityId === active);

  const only = companies.length === 1 ? companies[0] : undefined;
  if (only !== undefined) {
    return (
      <span className="text-text flex min-w-0 items-center gap-2 px-2 font-[510]">
        <Dot entityId={only.entityId} />
        <span className="truncate">{only.label}</span>
      </span>
    );
  }

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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          pending={pending}
          aria-label={shell('companyMenu', { company: current?.label ?? t('allCompanies') })}
          className="max-w-[min(16rem,45vw)] min-w-0 justify-start px-2"
        >
          {current === undefined ? (
            <Layers aria-hidden className="text-text-muted" />
          ) : (
            <Dot entityId={current.entityId} />
          )}
          <span className="truncate">{current?.label ?? t('allCompanies')}</span>
          <ChevronsUpDown aria-hidden className="text-text-muted" />
        </Button>
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
