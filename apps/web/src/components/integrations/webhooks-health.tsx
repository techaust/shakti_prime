'use client';

import type { FailedWebhook, WebhookHealth, WebhookProviderHealth } from '@shakti/contracts';
import { Button, DataGrid, EmptyState, StatusBadge, toast, type DataGridColumn } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { processWebhookAgain } from '../../actions/integrations';
import { formatCount, formatDateTime } from '../../screens/format';
import { webhookReason } from '../../screens/integrations';
import { DateTime } from '../date-time';
import { FailureMessage } from '../screens/failure';
import { useCommand } from '../screens/use-command';

/**
 * Integration health › Messages from other systems (docs/03-roadmap-appendix/phase2.md §5.1): per
 * system the last day's messages received, handled, failed and turned away, those waiting and the
 * oldest; then the failed ones, newest first, with Process again. Counts and times change from
 * minute to minute, so screenshots mask them.
 */
export function WebhooksHealth({ initial }: { initial: WebhookHealth }) {
  const t = useTranslations('integrations');
  const [rows, setRows] = useState(initial.failed.items);
  const [total, setTotal] = useState(initial.failed.total);
  const replay = useCommand(processWebhookAgain);
  const source = (provider: WebhookProviderHealth['provider']) =>
    t(`webhooks.providers.${provider}`);
  const count = (n: number) => <span data-dynamic>{formatCount(n)}</span>;

  const providerColumns: DataGridColumn<WebhookProviderHealth>[] = [
    { id: 'source', header: t('columns.source'), cell: (r) => source(r.provider), primary: true },
    {
      id: 'received',
      header: t('columns.received'),
      cell: (r) => count(r.received24h),
      numeric: true,
    },
    {
      id: 'handled',
      header: t('columns.handled'),
      cell: (r) => count(r.processed24h),
      numeric: true,
    },
    { id: 'failed', header: t('columns.failed'), cell: (r) => count(r.failed24h), numeric: true },
    {
      id: 'refused',
      header: t('columns.refused'),
      cell: (r) => count(r.refused24h),
      numeric: true,
    },
    { id: 'waiting', header: t('columns.waiting'), cell: (r) => count(r.waiting), numeric: true },
    {
      id: 'since',
      header: t('columns.since'),
      cell: (r) => (
        <span data-dynamic>
          {r.oldestWaitingAt === null ? '' : <DateTime value={r.oldestWaitingAt} />}
        </span>
      ),
    },
  ];

  const failedColumns: DataGridColumn<FailedWebhook>[] = [
    { id: 'source', header: t('columns.source'), cell: (r) => source(r.provider), primary: true },
    {
      id: 'reason',
      header: t('columns.reason'),
      // data-dynamic: a row handled again comes back with its new reason and tries, so
      // screenshots mask both.
      cell: (r) => (
        <span data-dynamic>
          <StatusBadge tone="danger">
            {t(`webhooks.reasons.${webhookReason(r.errorCode)}`)}
          </StatusBadge>
        </span>
      ),
    },
    {
      id: 'tries',
      header: t('columns.tries'),
      cell: (r) => <span data-dynamic>{formatCount(r.attempts)}</span>,
      numeric: true,
    },
    {
      id: 'receivedAt',
      header: t('columns.receivedAt'),
      cell: (r) => <DateTime value={r.receivedAt} />,
    },
    { id: 'failedAt', header: t('columns.failedAt'), cell: (r) => <DateTime value={r.failedAt} /> },
    {
      id: 'actions',
      header: t('columns.actions'),
      align: 'end',
      // The button keeps its visible words as its name; which message it handles is read out after.
      cell: (r) => (
        <>
          <span id={`webhook-${r.inboxId}`} className="sr-only">
            {t('webhooks.describe', {
              source: source(r.provider),
              at: formatDateTime(r.receivedAt),
            })}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={replay.pending}
            aria-describedby={`webhook-${r.inboxId}`}
            onClick={() => {
              replay.run({ inboxId: r.inboxId }, () => {
                setRows((all) => all.filter((row) => row.inboxId !== r.inboxId));
                setTotal((n) => Math.max(0, n - 1));
                toast.success(t('webhooks.processing'));
              });
            }}
          >
            {t('webhooks.processAgain')}
          </Button>
        </>
      ),
    },
  ];

  return (
    <section aria-labelledby="integrations-webhooks" className="flex flex-col gap-3">
      <h2 id="integrations-webhooks" className="text-h3">
        {t('webhooks.heading')}
      </h2>
      <p className="text-text-muted">{t('webhooks.intro')}</p>
      <DataGrid
        caption={t('webhooks.caption')}
        columns={providerColumns}
        rows={initial.providers}
        rowKey={(r) => r.provider}
        // Every system has a row, with zeros when nothing came in.
        empty={null}
      />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="integrations-webhooks-failed" className="text-h4">
          {t('webhooks.failedHeading')}
        </h3>
        <span data-dynamic className="text-text-muted">
          {t('webhooks.total', { count: total })}
        </span>
      </div>
      <p className="text-text-muted">{t('webhooks.failedIntro')}</p>
      <DataGrid
        caption={t('webhooks.failedCaption')}
        columns={failedColumns}
        rows={rows}
        rowKey={(r) => r.inboxId}
        empty={<EmptyState message={t('webhooks.empty')} />}
      />
      <FailureMessage failure={replay.failure} />
    </section>
  );
}
