'use client';

import type {
  CompositeRuleRow,
  Segment,
  TaxRateListRowDto,
  TaxSettingsDto,
} from '@shakti/contracts';
import { Button, DataGrid, EmptyState, type DataGridColumn } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useRef, useState } from 'react';
import { readTaxSettings } from '../../actions/tax';
import { formatDate } from '../../screens/format';
import { FailureMessage } from '../screens/failure';
import { useQuery } from '../screens/use-command';

/** The two forms, fetched when first opened rather than with the page. */
const RateDialog = dynamic(() => import('./rate-dialog').then((m) => m.RateDialog));
const RuleDialog = dynamic(() => import('./rule-dialog').then((m) => m.RuleDialog));

/**
 * Settings › Tax rates: the GST rates and the composite supply splits with the dates they apply.
 * Both belong to every company, so the add buttons show only while the person acts for all of
 * them; otherwise the screen says to choose All companies first.
 */
export function TaxSettingsScreen({ initial }: { initial: TaxSettingsDto }) {
  const t = useTranslations('taxSettings');
  const activity = useTranslations('activity');
  const common = useTranslations('common');
  const [settings, setSettings] = useState(initial);
  const [dialog, setDialog] = useState<'rate' | 'rule' | undefined>();
  const rateButton = useRef<HTMLButtonElement>(null);
  const ruleButton = useRef<HTMLButtonElement>(null);
  const { load, pending, failure } = useQuery<TaxSettingsDto>();
  const canChange = settings.coversAllCompanies;

  function reload() {
    load(readTaxSettings, (next) => {
      setSettings(next);
    });
  }

  const percent = (value: string) => t('percent', { value: String(Number(value)) });
  const until = (to: string | null) => (to === null ? t('openEnded') : formatDate(to));

  const rateColumns: DataGridColumn<TaxRateListRowDto>[] = [
    {
      id: 'target',
      header: t('columns.target'),
      primary: true,
      cell: (r) =>
        r.hsn === null
          ? t('itemTarget', { name: r.itemName ?? '', sku: r.itemSku ?? '' })
          : t('hsnTarget', { hsn: r.hsn }),
    },
    {
      id: 'rate',
      header: t('columns.rate'),
      align: 'end',
      numeric: true,
      cell: (r) => percent(r.ratePct),
    },
    { id: 'from', header: t('columns.from'), cell: (r) => formatDate(r.effectiveFrom) },
    { id: 'to', header: t('columns.to'), cell: (r) => until(r.effectiveTo) },
    {
      id: 'source',
      header: t('columns.source'),
      cell: (r) => r.sourceRef ?? <span className="text-text-muted">{common('notSet')}</span>,
    },
  ];
  const ruleColumns: DataGridColumn<CompositeRuleRow>[] = [
    {
      id: 'segment',
      header: t('columns.segment'),
      primary: true,
      cell: (r) => activity(`values.segment.${r.segment as Segment}`),
    },
    {
      id: 'goodsShare',
      header: t('columns.goodsShare'),
      align: 'end',
      numeric: true,
      cell: (r) => percent(r.goodsSharePct),
    },
    {
      id: 'servicesShare',
      header: t('columns.servicesShare'),
      align: 'end',
      numeric: true,
      cell: (r) => percent(r.servicesSharePct),
    },
    {
      id: 'goodsRate',
      header: t('columns.goodsRate'),
      align: 'end',
      numeric: true,
      cell: (r) => percent(r.goodsRatePct),
    },
    {
      id: 'servicesRate',
      header: t('columns.servicesRate'),
      align: 'end',
      numeric: true,
      cell: (r) => percent(r.servicesRatePct),
    },
    { id: 'from', header: t('columns.from'), cell: (r) => formatDate(r.effectiveFrom) },
    { id: 'to', header: t('columns.to'), cell: (r) => until(r.effectiveTo) },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-8">
      {canChange ? null : (
        <p role="note" className="bg-info-soft border-border rounded-md border px-4 py-3">
          {t('groupNote')}
        </p>
      )}
      <FailureMessage failure={failure} />
      <section aria-labelledby="tax-rates" className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="tax-rates" className="text-h2">
            {t('ratesHeading')}
          </h2>
          {canChange ? (
            <Button
              ref={rateButton}
              onClick={() => {
                setDialog('rate');
              }}
            >
              {t('addRate')}
            </Button>
          ) : null}
        </div>
        <DataGrid
          caption={t('ratesCaption')}
          columns={rateColumns}
          rows={settings.rates}
          rowKey={(r) => r.id}
          loading={pending}
          empty={<EmptyState message={t('ratesEmpty')} />}
        />
      </section>
      <section aria-labelledby="tax-rules" className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="tax-rules" className="text-h2">
            {t('rulesHeading')}
          </h2>
          {canChange ? (
            <Button
              ref={ruleButton}
              onClick={() => {
                setDialog('rule');
              }}
            >
              {t('addRule')}
            </Button>
          ) : null}
        </div>
        <DataGrid
          caption={t('rulesCaption')}
          columns={ruleColumns}
          rows={settings.compositeRules}
          rowKey={(r) => r.id}
          loading={pending}
          empty={<EmptyState message={t('rulesEmpty')} />}
        />
      </section>
      {dialog === 'rate' ? (
        <RateDialog
          returnFocusTo={() => [rateButton.current]}
          onClose={() => {
            setDialog(undefined);
          }}
          onSaved={() => {
            setDialog(undefined);
            reload();
          }}
        />
      ) : null}
      {dialog === 'rule' ? (
        <RuleDialog
          returnFocusTo={() => [ruleButton.current]}
          onClose={() => {
            setDialog(undefined);
          }}
          onSaved={() => {
            setDialog(undefined);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}
