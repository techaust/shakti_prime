'use client';

import type {
  WhatsAppBudgetHealth,
  WhatsAppNumberHealth,
} from '@shakti/contracts';
import { DataGrid, EmptyState, StatusBadge, type DataGridColumn, type StatusTone } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { MESSAGING_REFUSALS } from '../../screens/contract-values';
import { isOneOf } from '../../screens/customers';
import { formatCount } from '../../screens/format';
import { DateTime } from '../date-time';

const QUALITY_TONE: Record<WhatsAppNumberHealth['quality'], StatusTone> = {
  green: 'success',
  yellow: 'warning',
  red: 'danger',
  unknown: 'neutral',
};

/**
 * Integration health › WhatsApp (docs/03-roadmap-appendix/phase2.md §6.1): each company's number
 * with its quality and its templates waiting for review or turned down; the portfolio's daily limit
 * and how much of it is used; the last day's messages not sent, by the check that held them back.
 * Counts change from minute to minute, so screenshots mask them.
 */
export function WhatsAppHealth({
  numbers,
  budget,
  companies,
}: {
  numbers: WhatsAppNumberHealth[];
  budget: WhatsAppBudgetHealth;
  companies: Record<number, string>;
}) {
  const t = useTranslations('integrations.whatsapp');
  const thread = useTranslations('messaging.thread');
  const count = (n: number) => <span data-dynamic>{formatCount(n)}</span>;
  const columns: DataGridColumn<WhatsAppNumberHealth>[] = [
    {
      id: 'company',
      header: t('columns.company'),
      cell: (r) => companies[r.entityId] ?? '',
      primary: true,
    },
    {
      id: 'quality',
      header: t('columns.quality'),
      cell: (r) => <StatusBadge tone={QUALITY_TONE[r.quality]}>{t(`quality.${r.quality}`)}</StatusBadge>,
    },
    {
      id: 'pending',
      header: t('columns.pending'),
      cell: (r) => count(r.templatesPending),
      numeric: true,
    },
    {
      id: 'rejected',
      header: t('columns.rejected'),
      cell: (r) => count(r.templatesRejected),
      numeric: true,
    },
    {
      id: 'updated',
      header: t('columns.updated'),
      cell: (r) => (
        <span data-dynamic>{r.updatedAt === null ? t('never') : <DateTime value={r.updatedAt} />}</span>
      ),
    },
  ];
  const refused = budget.refusals.filter((r) => isOneOf(MESSAGING_REFUSALS, r.refusal));
  return (
    <section aria-labelledby="integrations-whatsapp" className="flex flex-col gap-3">
      <h2 id="integrations-whatsapp" className="text-h3">
        {t('heading')}
      </h2>
      <p className="text-text-muted text-sm">
        {budget.limitReported
          ? t('budget', { used: formatCount(budget.used), limit: formatCount(budget.limit) })
          : t('budgetStarting', {
              used: formatCount(budget.used),
              limit: formatCount(budget.limit),
            })}
      </p>
      {numbers.length === 0 ? (
        <EmptyState message={t('noNumbers')} />
      ) : (
        <DataGrid
          caption={t('caption')}
          columns={columns}
          rows={numbers}
          rowKey={(r) => r.channelId}
        />
      )}
      <h3 className="font-medium">{t('notSentHeading')}</h3>
      {refused.length === 0 && budget.failed === 0 ? (
        <p className="text-text-muted text-sm">{t('noneHeld')}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {refused.map((r) => (
            <li key={r.refusal}>
              {thread(`refusal.${r.refusal}`)} {count(r.count)}
            </li>
          ))}
          {budget.failed === 0 ? null : (
            <li>
              {t('failed')} {count(budget.failed)}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
