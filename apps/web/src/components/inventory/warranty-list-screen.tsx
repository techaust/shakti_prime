'use client';

import type { WarrantyClaimDto, WarrantyClaimPageDto, WarrantyClaimState } from '@shakti/contracts';
import { DataGrid, EmptyState, StatusBadge, type DataGridColumn } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { listWarrantyClaims } from '../../actions/warranty';
import { WARRANTY_CLAIM_STATES } from '../../screens/contract-values';
import { formatCount, formatDate } from '../../screens/format';
import { CLAIM_STATE_TONE, warrantyClaimHref, warrantyListHref } from '../../screens/warranty';
import { FailureMessage } from '../screens/failure';
import { useQuery } from '../screens/use-command';
import { useClaimStateText } from './use-inventory-text';

const PAGE_SIZE = 50;

/** A company or state to show, marked when it is the one shown, as the menu marks its screen. */
const CHIP =
  'text-text-muted hover:bg-highlight hover:text-text aria-[current=page]:bg-highlight aria-[current=page]:text-text rounded-md px-3 py-1.5 font-medium';

/**
 * `/inventory/warranty` (docs/03-roadmap-appendix/phase3.md §7.5): a company's warranty claims,
 * all or in one state, newest first; each opens its claim sheet. No cost shows here.
 */
export function WarrantyListScreen({
  initial,
  entityId,
  state,
  companies,
}: {
  initial: WarrantyClaimPageDto;
  entityId: number;
  state: WarrantyClaimState | undefined;
  companies: Record<number, string>;
}) {
  const t = useTranslations('warranty');
  const common = useTranslations('common');
  const stateText = useClaimStateText();
  const [rows, setRows] = useState(initial.items);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const { load, pending, failure } = useQuery<WarrantyClaimPageDto>();
  const total = WARRANTY_CLAIM_STATES.reduce((sum, s) => sum + initial.counts[s], 0);

  const columns: DataGridColumn<WarrantyClaimDto>[] = [
    {
      id: 'claim',
      header: t('columns.claim'),
      primary: true,
      cell: (c) => (
        <span className="flex flex-col">
          <Link
            href={warrantyClaimHref(entityId, c.id)}
            className="text-accent-text hover:underline"
          >
            {c.claimNo}
          </Link>
          <span className="text-text-muted text-xs">{formatDate(c.createdAt)}</span>
        </span>
      ),
    },
    {
      id: 'customer',
      header: t('columns.customer'),
      cell: (c) => c.account.name ?? t('customerHidden'),
    },
    {
      id: 'product',
      header: t('columns.product'),
      cell: (c) =>
        c.item === null ? (
          t('notIdentified')
        ) : (
          <span className="flex flex-col">
            <span>{c.item.name}</span>
            <span className="text-text-muted text-xs">{c.serial?.serialNo ?? c.item.sku}</span>
          </span>
        ),
    },
    {
      id: 'fault',
      header: t('columns.fault'),
      cell: (c) => <span className="line-clamp-2 break-words">{c.reportedFault}</span>,
    },
    {
      id: 'state',
      header: t('columns.state'),
      cell: (c) => <StatusBadge tone={CLAIM_STATE_TONE[c.state]}>{stateText(c.state)}</StatusBadge>,
    },
  ];

  const ids = Object.keys(companies).map(Number);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {ids.length > 1 ? (
        <nav aria-label={t('companiesLabel')} className="flex flex-wrap gap-2 text-sm">
          {ids.map((id) => (
            <Link
              key={id}
              href={warrantyListHref(id, state)}
              aria-current={id === entityId ? 'page' : undefined}
              className={CHIP}
            >
              {companies[id]}
            </Link>
          ))}
        </nav>
      ) : null}
      <nav aria-label={t('statesLabel')} className="flex flex-wrap gap-2 text-sm">
        <Link
          href={warrantyListHref(entityId)}
          aria-current={state === undefined ? 'page' : undefined}
          className={CHIP}
        >
          {t('allStates', { count: total, shown: formatCount(total) })}
        </Link>
        {WARRANTY_CLAIM_STATES.map((s) => (
          <Link
            key={s}
            href={warrantyListHref(entityId, s)}
            aria-current={state === s ? 'page' : undefined}
            className={CHIP}
          >
            {t('stateCount', {
              state: stateText(s),
              count: initial.counts[s],
              shown: formatCount(initial.counts[s]),
            })}
          </Link>
        ))}
      </nav>
      <FailureMessage failure={failure} />
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
        loading={pending && rows.length === 0}
        empty={<EmptyState message={t('empty')} />}
        loadMore={
          nextCursor === null
            ? undefined
            : {
                label: common('loadMore'),
                onLoadMore: () => {
                  load(
                    () =>
                      listWarrantyClaims({
                        entityId,
                        limit: PAGE_SIZE,
                        cursor: nextCursor,
                        ...(state === undefined ? {} : { state }),
                      }),
                    (page) => {
                      setRows((all) => [...all, ...page.items]);
                      setNextCursor(page.nextCursor);
                    },
                  );
                },
                pending,
              }
        }
      />
    </div>
  );
}
