import type { TeamQueueDto } from '@shakti/contracts';
import { Button, CardList, EmptyState } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { callerQueueHref } from '../../screens/calling';
import { formatCount } from '../../screens/format';

/**
 * The team lead's view (PRD TEL-01): each caller of the team, with the leads waiting in their
 * queue, the calls due, the late first calls and today's calls, and a link to their queue. A
 * table on wider screens and a card per caller on a phone (docs/08-design-system.md §5).
 */
export function TeamQueues({
  rows,
  companies,
  showCompany,
}: {
  rows: readonly TeamQueueDto[];
  companies: Record<number, string>;
  showCompany: boolean;
}) {
  const t = useTranslations('calling.team');
  if (rows.length === 0) return <EmptyState message={t('empty')} />;
  const openQueue = (row: TeamQueueDto) => (
    <Button size="sm" variant="secondary" asChild>
      <Link
        href={callerQueueHref(row.callerId, row.entityId)}
        aria-label={t('openQueueFor', { name: row.callerName })}
      >
        {t('openQueue')}
      </Link>
    </Button>
  );
  return (
    <>
      <CardList
        label={t('caption')}
        items={rows.map((row) => ({
          key: `${row.callerId}-${String(row.entityId)}`,
          title: row.callerName,
          fields: [
            ...(showCompany
              ? [{ id: 'company', label: t('company'), value: companies[row.entityId] ?? '' }]
              : []),
            { id: 'waiting', label: t('waiting'), value: formatCount(row.waiting), numeric: true },
            { id: 'due', label: t('due'), value: formatCount(row.due), numeric: true },
            { id: 'late', label: t('late'), value: formatCount(row.late), numeric: true },
            {
              id: 'callsToday',
              label: t('callsToday'),
              value: formatCount(row.callsToday),
              numeric: true,
            },
          ],
          actions: openQueue(row),
        }))}
      />
      <TeamQueuesTable
        rows={rows}
        companies={companies}
        showCompany={showCompany}
        openQueue={openQueue}
      />
    </>
  );
}

/** The callers as a table, on wider screens. */
function TeamQueuesTable({
  rows,
  companies,
  showCompany,
  openQueue,
}: {
  rows: readonly TeamQueueDto[];
  companies: Record<number, string>;
  showCompany: boolean;
  openQueue: (row: TeamQueueDto) => ReactNode;
}) {
  const t = useTranslations('calling.team');
  const number = 'px-3 py-2 text-right tabular-nums';
  return (
    <div className="border-border bg-surface hidden overflow-x-auto rounded-lg border md:block">
      <table className="w-full min-w-xl text-sm">
        <caption className="sr-only">{t('caption')}</caption>
        <thead className="bg-surface-2 text-text-muted">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              {t('caller')}
            </th>
            {showCompany ? (
              <th scope="col" className="px-3 py-2 text-left font-medium">
                {t('company')}
              </th>
            ) : null}
            <th scope="col" className={`${number} font-medium`}>
              {t('waiting')}
            </th>
            <th scope="col" className={`${number} font-medium`}>
              {t('due')}
            </th>
            <th scope="col" className={`${number} font-medium`}>
              {t('late')}
            </th>
            <th scope="col" className={`${number} font-medium`}>
              {t('callsToday')}
            </th>
            <th scope="col" className="px-3 py-2">
              <span className="sr-only">{t('openQueue')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.callerId}-${String(row.entityId)}`} className="border-border border-t">
              <th scope="row" className="px-3 py-2 text-left font-medium">
                {row.callerName}
              </th>
              {showCompany ? <td className="px-3 py-2">{companies[row.entityId] ?? ''}</td> : null}
              <td className={number}>{formatCount(row.waiting)}</td>
              <td className={number}>{formatCount(row.due)}</td>
              <td className={number}>{formatCount(row.late)}</td>
              <td className={number}>{formatCount(row.callsToday)}</td>
              <td className="px-3 py-2 text-right">{openQueue(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
