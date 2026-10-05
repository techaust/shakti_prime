'use client';

import type {
  QuoteBuilderDto,
  QuoteLineInput,
  QuotePreviewDto,
  SubsidyScheme,
} from '@shakti/contracts';
import { Button, Field, Input, Select, StatusBadge, toast } from '@shakti/ui';
import { Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createQuote, previewQuote } from '../../actions/quotes';
import { QUOTE_MAX_QTY, SUBSIDY_SCHEMES } from '../../screens/contract-values';
import { isOneOf } from '../../screens/customers';
import { formatCount, formatDate, formatRupees } from '../../screens/format';
import { quoteHref } from '../../screens/quotes';
import { FailureMessage } from '../screens/failure';
import { useCommand, useQuery } from '../screens/use-command';
import { QuoteLinesTable, QuoteTotals } from './quote-tables';

/** One line as the builder holds it: the chosen item or kit as `item:<id>` or `kit:<id>`. */
interface DraftLine {
  key: number;
  choice: string;
  qty: string;
  worksContract: boolean;
}

/** A quantity the quote takes: above zero, at most three decimals. */
const QUANTITY = /^\d{1,9}(\.\d{1,3})?$/;

/** A line with no item, or no quantity above zero. */
function lineMissing(line: DraftLine): boolean {
  const qty = line.qty.trim();
  return line.choice.split(':')[1] === undefined || !QUANTITY.test(qty) || Number(qty) <= 0;
}

/** A quantity past the most one line takes, which the server refuses too. */
function tooLarge(line: DraftLine): boolean {
  const qty = line.qty.trim();
  return QUANTITY.test(qty) && Number(qty) > QUOTE_MAX_QTY;
}

/** The lines as the commands take them, or undefined while a line is not filled in. */
function linesOf(draft: readonly DraftLine[]): QuoteLineInput[] | undefined {
  const lines: QuoteLineInput[] = [];
  for (const line of draft) {
    const qty = line.qty.trim();
    const [kind, id] = line.choice.split(':');
    if (id === undefined || lineMissing(line) || tooLarge(line)) return undefined;
    lines.push({
      ...(kind === 'kit' ? { kitId: id } : { itemId: id }),
      qty,
      worksContract: line.worksContract,
    });
  }
  return lines.length === 0 ? undefined : lines;
}

/**
 * The quote builder (docs/design/phase1.md §7.3): the person picks items or kits from the
 * customer's price list and the quantities; the server works out the quote (`previewQuote`) and
 * makes it (`createQuote`) with the prices of the list and the tax of the engine. No amount is
 * typed or worked out here.
 */
export function QuoteBuilder({ builder }: { builder: QuoteBuilderDto }) {
  const t = useTranslations('quotes.builder');
  const router = useRouter();
  const [lines, setLines] = useState<DraftLine[]>([
    { key: 1, choice: '', qty: '1', worksContract: false },
  ]);
  const [scheme, setScheme] = useState<SubsidyScheme>('none');
  const [preview, setPreview] = useState<QuotePreviewDto | undefined>();
  const [incomplete, setIncomplete] = useState(false);
  const work = useQuery<QuotePreviewDto>();
  const make = useCommand(createQuote);
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
      : {
          entityId: builder.entityId,
          opportunityId: builder.opportunityId,
          scheme,
          lines: filled,
        };
  }

  function workOut() {
    const wanted = input();
    if (wanted === undefined) return;
    work.load(() => previewQuote(wanted), setPreview);
  }

  function makeQuote() {
    const wanted = input();
    if (wanted === undefined || make.pending) return;
    make.run(wanted, (quote) => {
      toast.success(t('made', { number: quote.quoteNo }));
      router.push(quoteHref(quote.entityId, quote.id));
    });
  }

  const sizing = builder.sizing;
  const sizingText =
    sizing === null
      ? t('sizingNone')
      : sizing.stale
        ? t('sizingStale')
        : sizing.kind === 'pump'
          ? sizing.hp === null
            ? t('sizingPumpNoHp')
            : t('sizingPump', { hp: formatCount(sizing.hp) })
          : t('sizingRooftop', { kwp: formatCount(sizing.kwp ?? 0) });

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-text-muted text-sm">{t('lead')}</dt>
          <dd className="break-words">{builder.pipelineName}</dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-text-muted text-sm">{t('tier')}</dt>
          <dd className="break-words">{builder.tierName ?? t('tierNone')}</dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-text-muted text-sm">{t('sizing')}</dt>
          <dd className="flex flex-wrap items-center gap-2 break-words">
            <span>{sizingText}</span>
            {sizing === null || sizing.stale ? null : (
              <StatusBadge tone={sizing.inBounds ? 'success' : 'warning'}>
                {sizing.inBounds ? t('sizingInside') : t('sizingOutside')}
              </StatusBadge>
            )}
          </dd>
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
        <section aria-labelledby="quote-lines" className="flex flex-col gap-4">
          <h2 id="quote-lines" className="text-h3">
            {t('linesHeading')}
          </h2>
          <div className="max-w-xs">
            <Field id="quote-scheme" label={t('scheme')}>
              <Select
                value={scheme}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  if (isOneOf(SUBSIDY_SCHEMES, value)) {
                    setPreview(undefined);
                    setScheme(value);
                  }
                }}
              >
                {SUBSIDY_SCHEMES.map((s) => (
                  <option key={s} value={s}>
                    {t(`schemes.${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <ol className="flex flex-col gap-3">
            {lines.map((line, index) => (
              <li
                key={line.key}
                className="border-border grid grid-cols-1 items-end gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,1fr)_auto]"
              >
                <Field id={`quote-line-${String(line.key)}-item`} label={t('item')}>
                  <Select
                    value={line.choice}
                    onChange={(e) => {
                      change(line.key, { choice: e.currentTarget.value });
                    }}
                  >
                    <option value="">{t('itemChoose')}</option>
                    {builder.choices.map((c) => (
                      <option key={`${c.kind}:${c.id}`} value={`${c.kind}:${c.id}`}>
                        {t(c.kind === 'kit' ? 'kitOption' : 'itemOption', {
                          name: c.name,
                          sku: c.sku,
                          price: formatRupees(c.price),
                        })}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  id={`quote-line-${String(line.key)}-qty`}
                  label={t('quantity')}
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
                {builder.worksContractOffered ? (
                  <label className="flex items-start gap-2 text-sm sm:col-span-3">
                    <input
                      type="checkbox"
                      className="accent-accent mt-0.5 size-4"
                      checked={line.worksContract}
                      onChange={(e) => {
                        change(line.key, { worksContract: e.currentTarget.checked });
                      }}
                    />
                    <span className="flex flex-col">
                      <span>{t('worksContract')}</span>
                      <span className="text-text-muted text-xs">{t('worksContractHelper')}</span>
                    </span>
                  </label>
                ) : null}
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
                  {
                    key: Math.max(...all.map((l) => l.key)) + 1,
                    choice: '',
                    qty: '1',
                    worksContract: false,
                  },
                ]);
              }}
            >
              <Plus aria-hidden className="size-4" />
              {t('addLine')}
            </Button>
            <Button variant="secondary" pending={work.pending} onClick={workOut}>
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
        <section aria-labelledby="quote-preview" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="quote-preview" className="text-h3">
              {t('previewHeading')}
            </h2>
            <p className="text-text-muted text-sm">{t('previewNote')}</p>
            <p className="text-text-muted text-sm">
              {t('validUntil', { date: formatDate(preview.validUntil) })}
            </p>
          </div>
          <QuoteLinesTable lines={preview.lines} caption={t('linesCaption')} />
          <QuoteTotals totals={preview.totals} supplyKind={preview.supplyKind} />
          <FailureMessage failure={make.failure} />
          <div className="flex flex-wrap gap-2">
            <Button pending={make.pending} onClick={makeQuote}>
              {t('createQuote')}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
