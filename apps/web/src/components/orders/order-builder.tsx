'use client';

import type { OrderLineInput, SalesOrderBuilderDto, SalesOrderPreviewDto } from '@shakti/contracts';
import { Button, Field, Input, Select, toast } from '@shakti/ui';
import { Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createOrder, previewOrder } from '../../actions/orders';
import { QUOTE_MAX_QTY } from '../../screens/contract-values';
import { formatCount, formatRupees } from '../../screens/format';
import { orderHref } from '../../screens/orders';
import { QuoteLinesTable, QuoteTotals } from '../quotes/quote-tables';
import { FailureMessage } from '../screens/failure';
import { useCommand, useQuery } from '../screens/use-command';

/** One line as the form holds it: the chosen item's id and the quantity typed. */
interface DraftLine {
  key: number;
  itemId: string;
  qty: string;
}

/** A quantity an order takes: above zero, at most three decimals. */
const QUANTITY = /^\d{1,9}(\.\d{1,3})?$/;

function lineMissing(line: DraftLine): boolean {
  const qty = line.qty.trim();
  return line.itemId === '' || !QUANTITY.test(qty) || Number(qty) <= 0;
}

function tooLarge(line: DraftLine): boolean {
  const qty = line.qty.trim();
  return QUANTITY.test(qty) && Number(qty) > QUOTE_MAX_QTY;
}

function linesOf(draft: readonly DraftLine[]): OrderLineInput[] | undefined {
  if (draft.some((line) => lineMissing(line) || tooLarge(line))) return undefined;
  return draft.length === 0
    ? undefined
    : draft.map((line) => ({ itemId: line.itemId, qty: line.qty.trim() }));
}

/**
 * A dealer's order without a quote (docs/03-roadmap-appendix/phase1.md §8.3, SAL-06): the person picks items of
 * the dealer's price list and the quantities; the server works out the order (`previewOrder`) and
 * makes it (`createOrder`) with the list's prices and the engine's tax. No amount is typed or
 * worked out here.
 */
export function OrderBuilder({ builder }: { builder: SalesOrderBuilderDto }) {
  const t = useTranslations('orders.builder');
  const router = useRouter();
  const [lines, setLines] = useState<DraftLine[]>([{ key: 1, itemId: '', qty: '1' }]);
  const [preview, setPreview] = useState<SalesOrderPreviewDto | undefined>();
  const [incomplete, setIncomplete] = useState(false);
  const work = useQuery<SalesOrderPreviewDto>();
  const make = useCommand(createOrder);
  const ready = builder.tierName !== null && builder.priceListId !== null;

  function change(key: number, patch: Partial<DraftLine>) {
    setPreview(undefined);
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function input() {
    const filled = linesOf(lines);
    setIncomplete(filled === undefined);
    return filled === undefined
      ? undefined
      : { entityId: builder.entityId, accountId: builder.accountId, lines: filled };
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-text-muted text-sm">{t('tier')}</dt>
          <dd className="break-words">{builder.tierName ?? t('tierNone')}</dd>
        </div>
      </dl>

      {builder.tierName === null ? (
        <p role="note" className="text-text-muted">
          {t('tierMissing')}
        </p>
      ) : builder.priceListId === null ? (
        <p role="note" className="text-text-muted">
          {t('listMissing')}
        </p>
      ) : builder.choices.length === 0 ? (
        <p role="note" className="text-text-muted">
          {t('noChoices')}
        </p>
      ) : null}

      {ready && builder.choices.length > 0 ? (
        <section aria-labelledby="order-lines" className="flex flex-col gap-4">
          <h2 id="order-lines" className="text-h3">
            {t('linesHeading')}
          </h2>
          <ol className="flex flex-col gap-3">
            {lines.map((line, index) => (
              <li
                key={line.key}
                className="border-border grid grid-cols-1 items-start gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
              >
                <Field id={`order-line-${String(line.key)}-item`} label={t('item')}>
                  <Select
                    value={line.itemId}
                    onChange={(e) => {
                      change(line.key, { itemId: e.currentTarget.value });
                    }}
                  >
                    <option value="">{t('itemChoose')}</option>
                    {builder.choices.map((c) => (
                      <option key={c.id} value={c.id}>
                        {t('itemOption', {
                          name: c.name,
                          sku: c.sku,
                          price: formatRupees(c.price),
                        })}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  id={`order-line-${String(line.key)}-qty`}
                  label={t('quantity')}
                  actions={
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('removeLine', { n: index + 1 })}
                      disabled={lines.length === 1}
                      onClick={() => {
                        setPreview(undefined);
                        setLines((all) => all.filter((l) => l.key !== line.key));
                      }}
                    >
                      <X aria-hidden className="size-4" />
                      {t('remove')}
                    </Button>
                  }
                  error={
                    incomplete && tooLarge(line)
                      ? t('quantityTooLarge', { max: formatCount(QUOTE_MAX_QTY) })
                      : undefined
                  }
                >
                  <Input
                    inputMode="decimal"
                    value={line.qty}
                    maxLength={13}
                    autoComplete="off"
                    onChange={(e) => {
                      change(line.key, { qty: e.currentTarget.value });
                    }}
                  />
                </Field>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setPreview(undefined);
                setLines((all) => [
                  ...all,
                  { key: Math.max(...all.map((l) => l.key)) + 1, itemId: '', qty: '1' },
                ]);
              }}
            >
              <Plus aria-hidden className="size-4" />
              {t('addLine')}
            </Button>
            <Button
              variant="secondary"
              pending={work.pending}
              onClick={() => {
                const wanted = input();
                if (wanted !== undefined) work.load(() => previewOrder(wanted), setPreview);
              }}
            >
              {t('workOut')}
            </Button>
          </div>
          {incomplete && lines.some(lineMissing) ? (
            <p role="alert" className="text-danger text-sm">
              {t('linesIncomplete')}
            </p>
          ) : null}
          <FailureMessage failure={work.failure} />
        </section>
      ) : null}

      {preview === undefined ? null : (
        <section aria-labelledby="order-preview" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="order-preview" className="text-h3">
              {t('previewHeading')}
            </h2>
            <p className="text-text-muted text-sm">{t('previewNote')}</p>
          </div>
          <QuoteLinesTable lines={preview.lines} caption={t('linesCaption')} />
          <QuoteTotals totals={preview.totals} supplyKind={preview.supplyKind} />
          <FailureMessage failure={make.failure} />
          <div className="flex flex-wrap gap-2">
            <Button
              pending={make.pending}
              onClick={() => {
                const wanted = input();
                if (wanted === undefined || make.pending) return;
                make.run(wanted, (order) => {
                  toast.success(t('made', { number: order.soNo }));
                  router.push(orderHref(order.entityId, order.id));
                });
              }}
            >
              {t('create')}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
