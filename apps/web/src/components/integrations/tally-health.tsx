'use client';

import type { ConnectorHealth } from '@shakti/contracts';
import { DataGrid, EmptyState, StatusBadge, type DataGridColumn, type StatusTone } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { formatCount } from '../../screens/format';
import { DateTime } from '../date-time';

/** How a connector's heartbeat shows: silent in red, late in amber, checking in in green. */
const HEALTH_TONES: Record<ConnectorHealth['health'], StatusTone> = {
  ok: 'success',
  late: 'warning',
  silent: 'danger',
  never_seen: 'neutral',
};

/**
 * Integration health's Tally section (TC2): each company a Tally connector serves, with the
 * connector's last check-in, how far the BOS is behind Tally, the records waiting on the office PC
 * and the ones it set aside, and why the connector is not reading the company, if it is not.
 */
export function TallyHealth({
  connectors,
  companies,
}: {
  connectors: readonly ConnectorHealth[];
  companies: Record<number, string>;
}) {
  const t = useTranslations('integrations.tally');
  const columns: DataGridColumn<ConnectorHealth>[] = [
    { id: 'connector', header: t('columns.connector'), cell: (r) => r.name, primary: true },
    {
      id: 'company',
      header: t('columns.company'),
      cell: (r) => (
        <span>
          {companies[r.entityId] ?? t('otherCompany')}
          <span className="block text-text-muted">{r.company}</span>
        </span>
      ),
    },
    {
      id: 'health',
      header: t('columns.health'),
      cell: (r) => (
        <StatusBadge tone={HEALTH_TONES[r.health]}>{t(`health.${r.health}`)}</StatusBadge>
      ),
    },
    {
      id: 'heartbeat',
      header: t('columns.lastCheckIn'),
      cell: (r) =>
        r.lastHeartbeatAt === null ? (
          <span className="text-text-muted">{t('never')}</span>
        ) : (
          <DateTime value={r.lastHeartbeatAt} />
        ),
    },
    {
      id: 'lag',
      header: t('columns.behind'),
      numeric: true,
      cell: (r) =>
        r.lag === null ? (
          <span className="text-text-muted">{t('notKnown')}</span>
        ) : (
          <span data-dynamic>{formatCount(r.lag)}</span>
        ),
    },
    {
      id: 'waiting',
      header: t('columns.waiting'),
      numeric: true,
      cell: (r) => <span data-dynamic>{formatCount(r.queueDepth)}</span>,
    },
    {
      id: 'held',
      header: t('columns.setAside'),
      cell: (r) =>
        r.heldRows > 0 ? (
          <StatusBadge tone="warning">{t('setAside', { count: r.heldRows })}</StatusBadge>
        ) : (
          <span className="text-text-muted">{t('noneSetAside')}</span>
        ),
    },
    {
      id: 'problem',
      header: t('columns.problem'),
      cell: (r) =>
        r.problem === null ? (
          <span className="text-text-muted">{t('noProblem')}</span>
        ) : (
          t(`problem.${r.problem}`)
        ),
    },
  ];
  return (
    <section aria-labelledby="integrations-tally" className="flex flex-col gap-3">
      <h2 id="integrations-tally" className="text-h3">
        {t('heading')}
      </h2>
      <p className="text-text-muted">{t('intro')}</p>
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={connectors}
        rowKey={(r) => `${r.connectorId}-${String(r.entityId)}-${r.company}`}
        empty={<EmptyState message={t('empty')} />}
      />
    </section>
  );
}
