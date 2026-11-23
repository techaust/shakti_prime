'use client';

import type { CompareCellDto, CompareQuotesDto, ItemCategory } from '@shakti/contracts';
import { Button, CardList, EmptyState, Field, Select, StatusBadge } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { compareQuotes } from '../../actions/procurement';
import { ITEM_CATEGORIES } from '../../screens/contract-values';
import { formatDate } from '../../screens/format';
import { formatQuantity, formatRate } from '../../screens/procurement';
import { useOpenFile } from '../files/use-open-file';
import { FailureMessage } from '../screens/failure';
import { useQuery } from '../screens/use-command';

/**
 * Procurement › Compare (INV-04): for one company, the items of a category down and the vendors
 * with a quote across. Each cell shows the valid rate, the minimum order and the delivery time,
 * with the quote document a click away; the lowest valid rate of each row is marked as the query
 * marked it, and an expired quote is shown as expired and never marked. Only a holder of
 * `procurement.rate.read` reaches this screen.
 */
export function CompareScreen({
  initial,
  companies,
}: {
  initial: CompareQuotesDto;
  companies: readonly { id: number; name: string }[];
}) {
  const t = useTranslations('procurement.compare');
  const p = useTranslations('procurement');
  const [result, setResult] = useState(initial);
  const [entityId, setEntityId] = useState(initial.entityId);
  const [category, setCategory] = useState<ItemCategory | ''>(initial.category ?? '');
  const { load, pending, failure } = useQuery<CompareQuotesDto>();
  const doc = useOpenFile();

  function read(nextEntity: number, nextCategory: ItemCategory | '') {
    setEntityId(nextEntity);
    setCategory(nextCategory);
    load(
      () =>
        compareQuotes({
          entityId: nextEntity,
          ...(nextCategory === '' ? {} : { category: nextCategory }),
        }),
      setResult,
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap">
        <Field id="compare-company" label={t('company')} className="md:w-64">
          <Select
            value={String(entityId)}
            onChange={(e) => {
              read(Number(e.currentTarget.value), category);
            }}
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="compare-category" label={t('category')} className="md:w-56">
          <Select
            value={category}
            onChange={(e) => {
              read(entityId, e.currentTarget.value as ItemCategory | '');
            }}
          >
            <option value="">{t('allCategories')}</option>
            {ITEM_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {p(`categories.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <p className="text-text-muted">{t('asOf', { date: formatDate(result.asOf) })}</p>
      <FailureMessage failure={failure} />
      <FailureMessage failure={doc.failure} />
      {result.rows.length === 0 ? (
        <EmptyState message={t('empty')} />
      ) : (
        <>
          {/* A card per item on a phone (docs/08-design-system.md §5); the table on wider screens. */}
          <CardList
            label={t('caption')}
            items={result.rows.map((row) => ({
              key: row.itemId,
              title: (
                <>
                  {row.itemName}
                  <span className="text-text-muted block text-xs font-normal">
                    {row.sku} · {t('perUnit', { unit: p(`units.${row.unit}`) })}
                  </span>
                </>
              ),
              fields: result.vendors.map((v) => {
                const cell = row.cells.find((c) => c.vendorId === v.id);
                return {
                  id: v.id,
                  label: v.name,
                  value:
                    cell === undefined ? (
                      t('noQuote')
                    ) : (
                      <Cell
                        cell={cell}
                        opening={doc.opening}
                        onOpen={(fileId) => {
                          doc.open(fileId);
                        }}
                        itemName={row.itemName}
                        vendorName={v.name}
                      />
                    ),
                };
              }),
            }))}
          />
          <div
            className="border-border hidden overflow-x-auto rounded-md border md:block"
            role="region"
            aria-label={t('caption')}
            tabIndex={0}
            aria-busy={pending}
          >
            <table className="w-full min-w-max text-left">
              <caption className="sr-only">{t('caption')}</caption>
              <thead className="bg-surface-2 text-text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t('item')}
                  </th>
                  {result.vendors.map((v) => (
                    <th key={v.id} scope="col" className="px-3 py-2 font-medium">
                      {v.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.itemId} className="border-border border-t align-top">
                    <th scope="row" className="px-3 py-2 font-medium">
                      {row.itemName}
                      <span className="text-text-muted block font-normal">
                        {row.sku} · {t('perUnit', { unit: p(`units.${row.unit}`) })}
                      </span>
                    </th>
                    {result.vendors.map((v) => {
                      const cell = row.cells.find((c) => c.vendorId === v.id);
                      return (
                        <td key={v.id} className="px-3 py-2">
                          {cell === undefined ? (
                            <span className="text-text-muted">{t('noQuote')}</span>
                          ) : (
                            <Cell
                              cell={cell}
                              opening={doc.opening}
                              onOpen={(fileId) => {
                                doc.open(fileId);
                              }}
                              itemName={row.itemName}
                              vendorName={v.name}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Cell({
  cell,
  opening,
  onOpen,
  itemName,
  vendorName,
}: {
  cell: CompareCellDto;
  opening: boolean;
  onOpen: (fileId: string) => void;
  itemName: string;
  vendorName: string;
}) {
  const t = useTranslations('procurement.compare');
  const p = useTranslations('procurement');
  return (
    <div className="flex flex-col gap-1">
      <p className="font-medium tabular-nums">
        {formatRate(cell.rate)}{' '}
        {cell.isLowest ? <StatusBadge tone="success">{t('lowest')}</StatusBadge> : null}
        {cell.status === 'expired' ? (
          <StatusBadge tone="neutral">{t('expired')}</StatusBadge>
        ) : null}
      </p>
      <p className="text-text-muted">
        {cell.moq === null ? t('noMoq') : t('moq', { qty: formatQuantity(cell.moq) })}
      </p>
      <p className="text-text-muted">
        {cell.leadTimeDays === null ? t('noLeadTime') : p('days', { count: cell.leadTimeDays })}
      </p>
      <p className="text-text-muted">
        {cell.status === 'expired'
          ? t('endedOn', { date: formatDate(cell.validUntil) })
          : t('validUntil', { date: formatDate(cell.validUntil) })}
        {' · '}
        {cell.entityId === null ? t('forGroup') : t('forCompany')}
      </p>
      {cell.fileId === null ? null : (
        <Button
          variant="link"
          size="sm"
          className="self-start"
          pending={opening}
          aria-label={t('openDocumentFor', { item: itemName, vendor: vendorName })}
          onClick={() => {
            if (cell.fileId !== null) onOpen(cell.fileId);
          }}
        >
          {t('openDocument')}
        </Button>
      )}
    </div>
  );
}
