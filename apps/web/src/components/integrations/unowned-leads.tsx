'use client';

import type { UnownedIngestLeadDto, UnownedIngestLeadsDto } from '@shakti/contracts';
import { DataGrid, EmptyState, type DataGridColumn } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { INGEST_CHANNELS } from '../../screens/contract-values';
import { oneOf } from '../../screens/audit';
import { DateTime } from '../date-time';

/**
 * Integration health › Leads nobody has yet (docs/03-roadmap-appendix/phase2.md §6.2): open leads
 * from ads, forms, websites and WhatsApp that arrived when the company had no tele-caller present
 * and no Sales Team Lead, so `crm.lead.ingest` left them unassigned; each links to its customer,
 * where it is given to someone.
 */
export function UnownedLeads({
  initial,
  companies,
}: {
  initial: UnownedIngestLeadsDto;
  companies: Record<number, string>;
}) {
  const t = useTranslations('integrations.unowned');
  const activity = useTranslations('activity');
  const columns: DataGridColumn<UnownedIngestLeadDto>[] = [
    {
      id: 'customer',
      header: t('columns.customer'),
      primary: true,
      cell: (r) => <Link href={`/customers/${r.accountId}`}>{t('open')}</Link>,
    },
    { id: 'company', header: t('columns.company'), cell: (r) => companies[r.entityId] ?? '' },
    {
      id: 'channel',
      header: t('columns.channel'),
      cell: (r) =>
        oneOf(INGEST_CHANNELS, r.channel) ? activity(`values.leadChannel.${r.channel}`) : '',
    },
    { id: 'arrived', header: t('columns.arrived'), cell: (r) => <DateTime value={r.createdAt} /> },
  ];
  return (
    <section aria-labelledby="unowned-leads" className="flex flex-col gap-3">
      <h2 id="unowned-leads" className="text-h2">
        {t('heading')}
      </h2>
      <p className="text-text-muted text-sm">{t('intro')}</p>
      {initial.items.length === 0 ? null : (
        <p className="text-sm font-semibold">{t('total', { count: initial.total })}</p>
      )}
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={initial.items}
        rowKey={(r) => r.id}
        empty={<EmptyState message={t('empty')} />}
      />
    </section>
  );
}
