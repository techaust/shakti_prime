'use client';

import type { StockValuationDto, StockValuationRowDto } from '@shakti/contracts';
import {
  Button,
  DataGrid,
  DateInput,
  EmptyState,
  Field,
  Select,
  type DataGridColumn,
} from '@shakti/ui';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, type SyntheticEvent } from 'react';
import { formatRupees } from '../../screens/format';
import { formatQty } from '../../screens/inventory';
import { useCatalogueText } from '../catalogue/use-spec-text';
import { formText } from '../screens/form-data';

/**
 * `/inventory/valuation` (`finance.cost.read`): one company's stock at the close of a date, per
 * hub and category: the quantity held, its value from each movement's own cost, and the average
 * cost that value gives.
 */
export function ValuationScreen({
  valuation,
  companies,
}: {
  valuation: StockValuationDto;
  /** The companies the caller may choose between, by id. */
  companies: Record<number, string>;
}) {
  const t = useTranslations('inventory.valuation');
  const catalogue = useCatalogueText();
  const router = useRouter();
  const [date, setDate] = useState<string | undefined>(valuation.asOf);
  const [problem, setProblem] = useState(false);

  function apply(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const company =
      formText(new FormData(e.currentTarget), 'company') || String(valuation.entityId);
    if (date === undefined) {
      setProblem(true);
      return;
    }
    setProblem(false);
    router.push(`/inventory/valuation?company=${company}&date=${date}` as Route);
  }

  const columns: DataGridColumn<StockValuationRowDto>[] = [
    { id: 'hub', header: t('columns.hub'), primary: true, cell: (r) => r.hubName },
    { id: 'category', header: t('columns.category'), cell: (r) => catalogue.category(r.category) },
    { id: 'qty', header: t('columns.qty'), numeric: true, cell: (r) => formatQty(r.qty) },
    {
      id: 'avgCost',
      header: t('columns.avgCost'),
      numeric: true,
      cell: (r) => formatRupees(r.avgCost.replace(/(\.\d{2})\d*$/, '$1')),
    },
    { id: 'value', header: t('columns.value'), numeric: true, cell: (r) => formatRupees(r.value) },
  ];
  const ids = Object.keys(companies).map(Number);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <form onSubmit={apply} className="flex flex-col gap-3" aria-label={t('filters')}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ids.length > 1 ? (
            <Field id="valuation-company" label={t('company')}>
              <Select name="company" defaultValue={String(valuation.entityId)}>
                {ids.map((id) => (
                  <option key={id} value={id}>
                    {companies[id]}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field
            id="valuation-date"
            label={t('date')}
            helper={t('dateHelper')}
            error={problem ? t('dateInvalid') : undefined}
          >
            <DateInput
              defaultValue={valuation.asOf}
              invalid={problem}
              onValueChange={(iso) => {
                setDate(iso);
              }}
            />
          </Field>
        </div>
        <div>
          <Button type="submit">{t('apply')}</Button>
        </div>
      </form>
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={valuation.rows}
        rowKey={(r) => `${r.hubId}/${r.category}`}
        empty={<EmptyState message={t('empty')} />}
      />
      <p className="text-right font-semibold">
        {t('total', { value: formatRupees(valuation.total) })}
      </p>
    </div>
  );
}
