'use client';

import type { DuplicateKind, DuplicatePageDto, DuplicateRowDto } from '@shakti/contracts';
import { Button, EmptyState, Skeleton } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useRef, useState } from 'react';
import { listDuplicates } from '../../actions/duplicates';
import { FailureMessage } from '../screens/failure';
import { useQuery } from '../screens/use-command';
import { DuplicateCard } from './duplicate-card';

// The dialog loads when a merge is asked for, so the list ships only the cards.
const MergeDialog = dynamic(() => import('./merge-dialog').then((m) => m.MergeDialog));

const PAGE_SIZE = 25;
const FILTERS = ['all', 'customer', 'lead'] as const;
type Filter = (typeof FILTERS)[number];

/**
 * `/duplicates` (CRM-03): the open cards of the companies being viewed, surest first, a page at a
 * time, for a team lead and above. A card leaves the list once merged or set aside.
 */
export function DuplicatesScreen({
  initial,
  companies,
}: {
  initial: DuplicatePageDto;
  companies: Record<number, string>;
}) {
  const t = useTranslations('duplicates');
  const common = useTranslations('common');
  const [rows, setRows] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [filter, setFilter] = useState<Filter>('all');
  const [merging, setMerging] = useState<DuplicateRowDto | undefined>();
  const read = useQuery<DuplicatePageDto>();
  // The filter the rows on screen were read with; an older answer is dropped.
  const readWith = useRef<Filter>('all');

  const kindOf = (f: Filter): { kind?: DuplicateKind } => (f === 'all' ? {} : { kind: f });

  function show(next: Filter) {
    readWith.current = next;
    setFilter(next);
    setRows([]);
    setCursor(null);
    read.load(
      () => listDuplicates({ limit: PAGE_SIZE, ...kindOf(next) }),
      (page) => {
        if (readWith.current !== next) return;
        setRows(page.items);
        setCursor(page.nextCursor);
      },
    );
  }

  function loadMore() {
    if (cursor === null) return;
    const now = readWith.current;
    read.load(
      () => listDuplicates({ limit: PAGE_SIZE, cursor, ...kindOf(now) }),
      (page) => {
        if (readWith.current !== now) return;
        setRows((all) => [...all, ...page.items]);
        setCursor(page.nextCursor);
      },
    );
  }

  function remove(id: string) {
    setRows((all) => all.filter((r) => r.id !== id));
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div role="group" aria-label={t('filterLabel')} className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? 'primary' : 'secondary'}
            aria-pressed={filter === f}
            onClick={() => {
              show(f);
            }}
          >
            {t(`filter.${f}`)}
          </Button>
        ))}
      </div>
      <FailureMessage failure={read.failure} />
      {read.pending && rows.length === 0 ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState message={t('empty')} />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.id}>
              <DuplicateCard
                row={row}
                companies={companies}
                canMerge
                onMerge={setMerging}
                onDismissed={remove}
              />
            </li>
          ))}
        </ul>
      )}
      {cursor === null ? null : (
        <Button
          variant="secondary"
          className="self-start"
          pending={read.pending}
          onClick={loadMore}
        >
          {common('loadMore')}
        </Button>
      )}
      {merging === undefined ? null : (
        <MergeDialog
          row={merging}
          onCancel={() => {
            setMerging(undefined);
          }}
          onDone={() => {
            remove(merging.id);
            setMerging(undefined);
          }}
        />
      )}
    </div>
  );
}
