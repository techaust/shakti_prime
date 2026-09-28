'use client';

import type { AuditLogDto, AuditPageDto, AuditPeopleDto } from '@shakti/contracts';
import {
  Button,
  DataGrid,
  DateInput,
  EmptyState,
  Field,
  Select,
  StatusBadge,
  type DataGridColumn,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useRef, useState, type SyntheticEvent } from 'react';
import { listAuditLog, listAuditPeople } from '../../actions/admin';
import { ACTION_FILTERS, actionKey, auditWindow, type WindowProblem } from '../../screens/audit';
import { formatDateTime } from '../../screens/format';
import { FailureMessage } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useQuery } from '../screens/use-command';
import { OUTCOME_TONE, OUTCOMES } from './outcome';

/** The detail sheet of one row, fetched when a row is first opened rather than with the page. */
const ActivityDetailsSheet = dynamic(() =>
  import('./activity-details').then((m) => m.ActivityDetailsSheet),
);

const PAGE_SIZE = 50;

/** The filters as last applied: the reader's window and the optional narrowing. */
interface Applied {
  from: string;
  to: string;
  outcome?: string;
  command?: string;
  actorPrincipalId?: string;
}

function readerInput(applied: Applied, cursor?: string) {
  return {
    from: applied.from,
    to: applied.to,
    limit: PAGE_SIZE,
    ...(applied.outcome === undefined ? {} : { outcome: applied.outcome }),
    ...(applied.command === undefined ? {} : { command: applied.command }),
    ...(applied.actorPrincipalId === undefined
      ? {}
      : { actorPrincipalId: applied.actorPrincipalId }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

/**
 * Admin › Activity log: filters over a window of at most 93 days (the last seven by default),
 * the rows newest first with Load more, and a side sheet with the details of one row.
 */
export function ActivityScreen({
  initialDates,
  initialPage,
  initialPeople,
  companies,
}: {
  initialDates: { from: string; to: string };
  initialPage: AuditPageDto;
  initialPeople: AuditPeopleDto;
  companies: Record<number, string>;
}) {
  const t = useTranslations('activity');
  const common = useTranslations('common');
  const initialWindow = auditWindow(initialDates.from, initialDates.to);
  const [applied, setApplied] = useState<Applied>(
    initialWindow.ok ? { from: initialWindow.from, to: initialWindow.to } : { from: '', to: '' },
  );
  const [rows, setRows] = useState(initialPage.items);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [people, setPeople] = useState(initialPeople);
  const [from, setFrom] = useState<string | undefined>(initialDates.from);
  const [to, setTo] = useState<string | undefined>(initialDates.to);
  const [problem, setProblem] = useState<WindowProblem | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState<AuditLogDto | undefined>();
  const reader = useQuery<AuditPageDto>();
  const peopleReader = useQuery<AuditPeopleDto>();
  // The filters whose rows are wanted: an answer for filters changed since is dropped.
  const wanted = useRef(applied);

  function apply(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const window = auditWindow(from, to);
    setProblem(window.ok ? undefined : window.problem);
    if (!window.ok) return;
    const data = new FormData(e.currentTarget);
    const choice = (name: string) => {
      const value = formText(data, name);
      return value === '' ? undefined : value;
    };
    const outcome = choice('outcome');
    const command = choice('command');
    const actorPrincipalId = choice('actor');
    const next: Applied = {
      from: window.from,
      to: window.to,
      ...(outcome === undefined ? {} : { outcome }),
      ...(command === undefined ? {} : { command }),
      ...(actorPrincipalId === undefined ? {} : { actorPrincipalId }),
    };
    const windowChanged = next.from !== applied.from || next.to !== applied.to;
    setApplied(next);
    wanted.current = next;
    setRows([]);
    setNextCursor(null);
    setLoadingMore(false);
    reader.load(
      () => listAuditLog(readerInput(next)),
      (page) => {
        if (wanted.current !== next) return;
        setRows(page.items);
        setNextCursor(page.nextCursor);
      },
    );
    if (windowChanged) {
      peopleReader.load(
        () => listAuditPeople({ from: next.from, to: next.to }),
        (list) => {
          if (wanted.current === next) setPeople(list);
        },
      );
    }
  }

  function loadMore() {
    if (nextCursor === null) return;
    const current = applied;
    setLoadingMore(true);
    reader.load(
      () => listAuditLog(readerInput(current, nextCursor)),
      (page) => {
        if (wanted.current !== current) return;
        setRows((all) => [...all, ...page.items]);
        setNextCursor(page.nextCursor);
        setLoadingMore(false);
      },
    );
  }

  const actionName = (row: AuditLogDto) => t(`actions.${actionKey(row.command)}`);
  const columns: DataGridColumn<AuditLogDto>[] = [
    {
      id: 'when',
      header: t('columns.when'),
      numeric: true,
      cell: (r) => formatDateTime(r.createdAt),
    },
    { id: 'action', header: t('columns.action'), cell: actionName, primary: true },
    { id: 'person', header: t('columns.person'), cell: (r) => r.actorName ?? t('system') },
    {
      id: 'company',
      header: t('columns.company'),
      cell: (r) =>
        r.entityId === null ? t('noCompany') : (companies[r.entityId] ?? t('noCompany')),
    },
    {
      id: 'outcome',
      header: t('columns.outcome'),
      cell: (r) => (
        <StatusBadge tone={OUTCOME_TONE[r.outcome]}>{t(`outcome.${r.outcome}`)}</StatusBadge>
      ),
    },
    {
      id: 'details',
      header: <span className="sr-only">{t('columns.details')}</span>,
      align: 'end',
      cell: (r) => (
        <Button
          variant="secondary"
          size="sm"
          aria-label={t('viewLabel', {
            action: actionName(r),
            time: formatDateTime(r.createdAt),
          })}
          onClick={() => {
            setOpen(r);
          }}
        >
          {t('view')}
        </Button>
      ),
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <form
        onSubmit={apply}
        className="border-border bg-surface grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto] lg:items-start"
        noValidate
      >
        <Field
          id="activity-from"
          label={t('filters.from')}
          helper={t('filters.dateHelper')}
          error={problem === undefined ? undefined : t(`filters.${problem}`)}
        >
          <DateInput defaultValue={initialDates.from} onValueChange={setFrom} />
        </Field>
        <Field id="activity-to" label={t('filters.to')} helper={t('filters.dateHelper')}>
          <DateInput
            defaultValue={initialDates.to}
            onValueChange={setTo}
            invalid={problem === undefined ? undefined : true}
          />
        </Field>
        <Field id="activity-outcome" label={t('filters.outcome')}>
          <Select name="outcome" defaultValue="">
            <option value="">{t('filters.any')}</option>
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {t(`outcome.${o}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="activity-action" label={t('filters.action')}>
          <Select name="command" defaultValue="">
            <option value="">{t('filters.any')}</option>
            {ACTION_FILTERS.map((a) => (
              <option key={a.command} value={a.command}>
                {t(`actions.${a.key}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="activity-person" label={t('filters.person')}>
          <Select name="actor" defaultValue="">
            <option value="">{t('filters.any')}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" className="self-end lg:mt-6" pending={reader.pending && !loadingMore}>
          {t('filters.apply')}
        </Button>
      </form>
      <FailureMessage failure={reader.failure ?? peopleReader.failure} />
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        density="compact"
        loading={reader.pending && !loadingMore}
        empty={<EmptyState message={t('empty')} />}
        loadMore={
          nextCursor === null
            ? undefined
            : { label: common('loadMore'), onLoadMore: loadMore, pending: loadingMore }
        }
      />
      {open === undefined ? null : (
        <ActivityDetailsSheet
          row={open}
          companies={companies}
          closeLabel={common('close')}
          onClose={() => {
            setOpen(undefined);
          }}
        />
      )}
    </div>
  );
}
