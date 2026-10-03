'use client';

import type { LeadDto, LeadSort, PipelineDto } from '@shakti/contracts';
import type { LeadPage } from '@shakti/domain';
import {
  Button,
  DataGrid,
  EmptyState,
  StatusBadge,
  type DataGridColumn,
  type StatusTone,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { listLeads } from '../../actions/crm';
import { oneOf } from '../../screens/audit';
import { LEAD_SORT_COLUMNS, SCORE_FACTORS } from '../../screens/contract-values';
import { DateTime } from '../date-time';
import { formatDateTime, formatPhone } from '../../screens/format';
import { FailureMessage } from '../screens/failure';
import { sortInput, toListSort } from '../screens/list-sort';
import { useQuery } from '../screens/use-command';
import { useGridView } from '../screens/use-grid-view';
import { ViewsMenu } from '../screens/views-menu';

const PAGE_SIZE = 50;

const STATE_TONE: Record<LeadDto['state'], StatusTone> = {
  open: 'accent',
  nurture: 'info',
  won: 'success',
  lost: 'neutral',
};

/**
 * The leads grid with Load more; stage names come from the pipelines the lead form uses. The last
 * change and the score sort, on the server over every lead (`LEAD_SORT_COLUMNS`); a new sort
 * reads the first page again.
 */
export function LeadsScreen({
  initial,
  pipelines,
  companies,
  showCompany,
  canAdd,
}: {
  initial: LeadPage;
  pipelines: PipelineDto[];
  companies: Record<number, string>;
  showCompany: boolean;
  canAdd: boolean;
}) {
  const t = useTranslations('leads');
  const common = useTranslations('common');
  const [rows, setRows] = useState(initial.items);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const { load, pending, failure } = useQuery<LeadPage>();
  // The order the rows on screen were read in; an answer read in an older order is dropped.
  const sorted = useRef<LeadSort | undefined>(undefined);
  const view = useGridView({
    density: 'compact',
    onSortChange: (next) => {
      const sort = toListSort(next, LEAD_SORT_COLUMNS);
      sorted.current = sort;
      setRows([]);
      setNextCursor(null);
      load(
        () => listLeads({ limit: PAGE_SIZE, ...sortInput(sort) }),
        (page) => {
          if (sorted.current !== sort) return;
          setRows(page.items);
          setNextCursor(page.nextCursor);
        },
      );
    },
  });
  const stages = new Map(pipelines.flatMap((p) => p.stages.map((s) => [s.id, s.name] as const)));

  function loadMore() {
    if (nextCursor === null) return;
    const sort = sorted.current;
    load(
      () => listLeads({ limit: PAGE_SIZE, cursor: nextCursor, ...sortInput(sort) }),
      (page) => {
        if (sorted.current !== sort) return;
        setRows((all) => [...all, ...page.items]);
        setNextCursor(page.nextCursor);
      },
    );
  }

  const notRecorded = <span className="text-text-muted">{t('notRecorded')}</span>;
  const columns: DataGridColumn<LeadDto>[] = [
    {
      id: 'customer',
      header: t('columns.customer'),
      cell: (l) => l.account.name,
      primary: true,
    },
    {
      id: 'contact',
      header: t('columns.contact'),
      cell: (l) => l.contact?.name ?? notRecorded,
    },
    {
      id: 'phone',
      header: t('columns.phone'),
      numeric: true,
      cell: (l) =>
        l.contact?.phone == null ? (
          notRecorded
        ) : (
          <a href={`tel:${l.contact.phone}`} className="text-accent-text hover:underline">
            {formatPhone(l.contact.phone)}
          </a>
        ),
    },
    {
      id: 'stage',
      header: t('columns.stage'),
      cell: (l) => stages.get(l.stageId) ?? '',
    },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (l) => <StatusBadge tone={STATE_TONE[l.state]}>{t(`state.${l.state}`)}</StatusBadge>,
    },
  ];
  if (showCompany) {
    columns.push({
      id: 'company',
      header: t('columns.company'),
      cell: (l) => companies[l.entityId] ?? '',
    });
  }
  columns.push({
    id: 'score',
    header: t('score.column'),
    numeric: true,
    cell: (l) => <ScoreCell lead={l} />,
    sortable: true,
  });
  columns.push({
    id: 'updated',
    header: t('columns.updated'),
    numeric: true,
    cell: (l) => <DateTime value={l.updatedAt} />,
    sortable: true,
  });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <FailureMessage failure={failure} />
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={rows}
        rowKey={(l) => l.id}
        loading={pending && rows.length === 0}
        {...view.grid}
        toolbar={
          <ViewsMenu
            screen="leads"
            current={view.settings}
            standard={view.standard}
            onApply={view.apply}
          />
        }
        empty={
          canAdd ? (
            <EmptyState
              message={t('empty')}
              action={
                <Button asChild>
                  <Link href="/leads/new">{t('add')}</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState message={t('emptyReadOnly')} />
          )
        }
        loadMore={
          nextCursor === null
            ? undefined
            : { label: common('loadMore'), onLoadMore: loadMore, pending }
        }
      />
    </div>
  );
}

/**
 * A lead's score (CRM-06) as a disclosure: the number, and on press (mouse, keyboard or touch) why
 * the lead has it, each matching rule's points and when the score last changed.
 */
function ScoreCell({ lead }: { lead: Pick<LeadDto, 'score' | 'scoreReasons' | 'scoreChangedAt'> }) {
  const t = useTranslations('leads.score');
  const lines =
    lead.scoreReasons.length === 0
      ? [t('base')]
      : [
          ...lead.scoreReasons.map((r) =>
            t('reason', {
              factor: oneOf(SCORE_FACTORS, r.factor) ? t(`reasons.${r.factor}`) : r.factor,
              signed: `${r.points > 0 ? '+' : ''}${String(r.points)}`,
              points: r.points,
            }),
          ),
          ...(lead.scoreChangedAt === null
            ? []
            : [t('changed', { when: formatDateTime(lead.scoreChangedAt) })]),
        ];
  return (
    <details className="group">
      <summary
        className="text-accent-text flex min-h-8 cursor-pointer items-center list-none underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden"
        aria-label={t('label', { score: lead.score })}
      >
        {lead.score}
      </summary>
      <ul className="text-text-muted mt-1 flex max-w-60 flex-col gap-0.5 text-start text-xs whitespace-normal">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </details>
  );
}
