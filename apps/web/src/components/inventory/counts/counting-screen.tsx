'use client';

import type {
  ItemDto,
  StockCountBinDto,
  StockCountSheetDto,
  StockCountSheetRowDto,
} from '@shakti/contracts';
import { Button, Field, Input, Select, StatusBadge, toast } from '@shakti/ui';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, type SyntheticEvent } from 'react';
import { recordStockCount, submitStockCount } from '../../../actions/stock-counts';
import {
  countedQtyFromTyped,
  countHref,
  countReviewHref,
  resolveSerial,
  type CountBin,
  type SerialResolution,
} from '../../../screens/stock-counts';
import { FailureMessage, useFieldFailure } from '../../screens/failure';
import { formText } from '../../screens/form-data';
import { useCommand } from '../../screens/use-command';
import { useCatalogueText } from '../../catalogue/use-spec-text';
import { ItemFinder } from './item-finder';

/** What a counter counts: an item in a bin, from the sheet or found where none was listed. */
interface Target {
  binId: string;
  binCode: string;
  itemId: string;
  itemName: string;
  sku: string;
  unit: StockCountSheetRowDto['unit'];
  isSerialTracked: boolean;
  serialPattern: string | null;
  /** What the counter entered before, shown again to change it; empty for a recount. */
  serialNos: readonly string[];
}

const keyOf = (t: Pick<Target, 'binId' | 'itemId'>) => `${t.binId}/${t.itemId}`;

function targetOf(row: StockCountSheetRowDto): Target {
  return {
    binId: row.binId,
    binCode: row.binCode,
    itemId: row.itemId,
    itemName: row.itemName,
    sku: row.sku,
    unit: row.unit,
    isSerialTracked: row.isSerialTracked,
    serialPattern: row.serialPattern,
    serialNos: row.serialNos ?? [],
  };
}

/**
 * The counting screen (`inventory.count.record`, docs/03-roadmap-appendix/phase3.md §7.3): each bin
 * of the count with its items, one form at a time under the item being counted, its buttons at
 * the thumb's reach. It shows what the counter entered, never what the records expect; a recount
 * shows nothing of the first count. Stock found where none was listed is counted by choosing the
 * bin and finding the item. A large count is shown one bin at a time, chosen at the top.
 */
export function CountingScreen({
  sheet,
  binChoices,
  shownBin,
  allBins,
  bins,
  canReview,
}: {
  /** The count, with the rows of the bin shown (or of every bin). */
  sheet: StockCountSheetDto;
  /** Every bin of the count's sheet, with its items left to count. */
  binChoices: readonly CountBin[];
  /** The bin shown, or null for every bin. */
  shownBin: string | null;
  /** Whether the count is small enough to show every bin at once. */
  allBins: boolean;
  /** The bins of the count's hub a counter may count in, for stock found where none was listed. */
  bins: readonly StockCountBinDto[];
  canReview: boolean;
}) {
  const t = useTranslations('inventory.counts.sheet');
  const states = useTranslations('inventory.counts.states');
  const router = useRouter();
  const { count, rows, progress } = sheet;
  const [open, setOpen] = useState<Target | undefined>();
  const [foundBin, setFoundBin] = useState(bins[0]?.id ?? '');
  const submit = useCommand(submitStockCount);
  const counting = count.state === 'open' || count.state === 'counting';

  const byBin = new Map<string, StockCountSheetRowDto[]>();
  for (const row of rows) byBin.set(row.binCode, [...(byBin.get(row.binCode) ?? []), row]);

  function saved() {
    setOpen(undefined);
    router.refresh();
  }

  function send() {
    submit.run({ entityId: count.entityId, countId: count.id }, () => {
      toast.success(t('submitted'));
      router.refresh();
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div role="status" className="flex flex-col gap-1">
        {counting ? (
          <>
            <p className="font-medium">{t('progress', { count: progress.toCount })}</p>
            {progress.recountOpen > 0 ? (
              <p className="text-warning">
                {t('recountProgress', { count: progress.recountOpen })}
              </p>
            ) : null}
          </>
        ) : (
          <p>{t('closed', { state: states(count.state) })}</p>
        )}
      </div>

      {binChoices.length > 1 ? (
        <Field id="count-bin" label={t('chooseBin')}>
          <Select
            value={shownBin ?? ''}
            onChange={(e) => {
              const bin = e.currentTarget.value;
              router.push(countHref(count.entityId, count.id, bin === '' ? undefined : bin));
            }}
          >
            {allBins ? <option value="">{t('allBins')}</option> : null}
            {binChoices.map((b) => (
              <option key={b.binId} value={b.binId}>
                {t('binChoice', { bin: b.binCode, count: b.left })}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      {rows.length === 0 ? <p className="text-text-muted">{t('empty')}</p> : null}
      {[...byBin.entries()].map(([binCode, items]) => (
        <section key={binCode} aria-labelledby={`bin-${binCode}`} className="flex flex-col gap-2">
          <h2 id={`bin-${binCode}`} className="text-h3">
            {t('bin', { bin: binCode })}
          </h2>
          <ul aria-label={t('binList', { bin: binCode })} className="flex flex-col gap-2">
            {items.map((row) => {
              const target = targetOf(row);
              const isOpen = open !== undefined && keyOf(open) === keyOf(target);
              return (
                <li key={keyOf(target)} className="border-border rounded-md border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{row.itemName}</p>
                      <p className="text-text-muted text-sm">{row.sku}</p>
                      <RowState row={row} />
                    </div>
                    {counting && !isOpen ? (
                      <Button
                        variant={row.state === 'counted' ? 'secondary' : 'primary'}
                        aria-label={
                          row.state === 'counted'
                            ? t('change', { name: row.itemName })
                            : t('countItem', { name: row.itemName })
                        }
                        onClick={() => {
                          setOpen(target);
                        }}
                      >
                        {row.state === 'counted' ? t('changeButton') : t('countButton')}
                      </Button>
                    ) : null}
                  </div>
                  {isOpen ? (
                    <CountForm
                      entityId={count.entityId}
                      countId={count.id}
                      target={target}
                      onClose={() => {
                        setOpen(undefined);
                      }}
                      onSaved={saved}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {counting && bins.length > 0 ? (
        <section aria-labelledby="count-found" className="flex flex-col gap-3">
          <h2 id="count-found" className="text-h3">
            {t('found')}
          </h2>
          <p className="text-text-muted text-sm">{t('foundIntro')}</p>
          <Field id="count-found-bin" label={t('foundBin')}>
            <Select
              value={foundBin}
              onChange={(e) => {
                setFoundBin(e.currentTarget.value);
              }}
            >
              {bins.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code}
                </option>
              ))}
            </Select>
          </Field>
          <ItemFinder
            id="count-found-item"
            chooseLabel={(item) => t('countItem', { name: item.name })}
            onChoose={(item: ItemDto) => {
              const bin = bins.find((b) => b.id === foundBin);
              if (bin === undefined) return;
              const listed = rows.find((r) => r.binId === bin.id && r.itemId === item.id);
              setOpen(
                listed !== undefined
                  ? targetOf(listed)
                  : {
                      binId: bin.id,
                      binCode: bin.code,
                      itemId: item.id,
                      itemName: item.name,
                      sku: item.sku,
                      unit: item.unit,
                      isSerialTracked: item.isSerialTracked,
                      serialPattern: null,
                      serialNos: [],
                    },
              );
            }}
          />
          {open !== undefined && !rows.some((r) => keyOf(targetOf(r)) === keyOf(open)) ? (
            <div className="border-border rounded-md border p-3">
              <p className="font-medium">{`${open.itemName} (${open.sku})`}</p>
              <p className="text-text-muted text-sm">{t('bin', { bin: open.binCode })}</p>
              <CountForm
                entityId={count.entityId}
                countId={count.id}
                target={open}
                onClose={() => {
                  setOpen(undefined);
                }}
                onSaved={saved}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="flex flex-col gap-3">
        {count.state === 'counting' ? (
          <>
            <p className="text-text-muted text-sm">{t('submitHint')}</p>
            <FailureMessage failure={submit.failure} />
            <Button pending={submit.pending} onClick={send} className="w-full sm:w-auto">
              {t('submit')}
            </Button>
          </>
        ) : null}
        {canReview && count.state !== 'open' ? (
          <Link
            className="text-accent-text underline-offset-4 hover:underline"
            href={countReviewHref(count.entityId, count.id)}
          >
            {t('reviewLink')}
          </Link>
        ) : null}
        <Link
          className="text-accent-text underline-offset-4 hover:underline"
          href="/inventory/counts"
        >
          {t('back')}
        </Link>
      </div>
    </div>
  );
}

/** Where an item in a bin stands, and what the counter entered once counted. */
function RowState({ row }: { row: StockCountSheetRowDto }) {
  const t = useTranslations('inventory.counts.sheet');
  const catalogue = useCatalogueText();
  if (row.state === 'recount') {
    return (
      <StatusBadge tone="warning" className="mt-1">
        {t('recount')}
      </StatusBadge>
    );
  }
  if (row.state === 'to_count') {
    return (
      <StatusBadge tone="neutral" className="mt-1">
        {t('toCount')}
      </StatusBadge>
    );
  }
  return (
    <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
      <StatusBadge tone="success">{t('counted')}</StatusBadge>
      <span>
        {row.isSerialTracked
          ? t('youFound', { count: row.serialNos?.length ?? 0 })
          : t('youEntered', { qty: catalogue.quantity(row.unit, Number(row.countedQty ?? '0')) })}
      </span>
    </p>
  );
}

/** The count of one item in one bin: a quantity, or the serial numbers found, one at a time. */
function CountForm({
  entityId,
  countId,
  target,
  onClose,
  onSaved,
}: {
  entityId: number;
  countId: string;
  target: Target;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('inventory.counts.sheet');
  const catalogue = useCatalogueText();
  const { run, pending, failure } = useCommand(recordStockCount, keyOf(target));
  const { fieldError, formFailure } = useFieldFailure(failure, ['qty', 'serialNos']);
  const [serials, setSerials] = useState<string[]>([...target.serialNos]);
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<SerialResolution['status'] | 'qty' | undefined>();
  const id = `count-${target.binId}-${target.itemId}`;

  function addSerial() {
    const resolved = resolveSerial(code, serials, target.serialPattern);
    if (resolved.status === 'ok') {
      setSerials((current) => [...current, resolved.code]);
      setCode('');
      setProblem(undefined);
      return;
    }
    setProblem(resolved.status === 'empty' ? undefined : resolved.status);
  }

  function save(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const base = { entityId, countId, binId: target.binId, itemId: target.itemId };
    if (target.isSerialTracked) {
      run({ ...base, serialNos: serials }, () => {
        toast.success(t('saved'));
        onSaved();
      });
      return;
    }
    const qty = countedQtyFromTyped(formText(new FormData(e.currentTarget), 'qty'));
    if (qty === undefined) {
      setProblem('qty');
      return;
    }
    setProblem(undefined);
    run({ ...base, qty }, () => {
      toast.success(t('saved'));
      onSaved();
    });
  }

  return (
    <form onSubmit={save} className="mt-3 flex flex-col gap-3" noValidate>
      {target.isSerialTracked ? (
        <>
          <Field
            id={`${id}-serial`}
            label={t('serial')}
            helper={t('serialHelper')}
            error={
              problem === 'repeat'
                ? t('serialRepeat')
                : problem === 'pattern'
                  ? t('serialPattern')
                  : fieldError('serialNos')
            }
            actions={
              <Button type="button" variant="secondary" onClick={addSerial}>
                {t('addSerial')}
              </Button>
            }
          >
            <Input
              value={code}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={100}
              enterKeyHint="done"
              onChange={(e) => {
                setCode(e.currentTarget.value);
              }}
              onKeyDown={(e) => {
                // A handheld scanner ends each code with Enter: it adds the serial, not the form.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addSerial();
                }
              }}
            />
          </Field>
          {serials.length === 0 ? (
            <p className="text-text-muted text-sm">{t('noSerials')}</p>
          ) : (
            <ul aria-label={t('serialsFound')} className="flex flex-col gap-1">
              {serials.map((serial) => (
                <li key={serial} className="flex items-center justify-between gap-3">
                  <span className="font-mono break-all">{serial}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={t('removeSerial', { serial })}
                    onClick={() => {
                      setSerials((current) => current.filter((s) => s !== serial));
                    }}
                  >
                    {t('remove')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <Field
          id={`${id}-qty`}
          label={t('qty')}
          helper={t('qtyHelper', { unit: catalogue.unit(target.unit) })}
          error={problem === 'qty' ? t('qtyInvalid') : fieldError('qty')}
        >
          <Input
            name="qty"
            inputMode="decimal"
            autoComplete="off"
            maxLength={14}
            enterKeyHint="done"
          />
        </Field>
      )}
      <FailureMessage failure={formFailure} />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" pending={pending} className="flex-1 sm:flex-none">
          {t('save')}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('close')}
        </Button>
      </div>
    </form>
  );
}
