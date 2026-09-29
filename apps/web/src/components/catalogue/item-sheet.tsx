'use client';

import type { ItemDetailDto, ItemDto, PumpCurvePointDto } from '@shakti/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  StatusBadge,
  toast,
  type ReturnFocusTo,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { archiveItem, getItem } from '../../actions/catalogue';
import { ITEM_SPEC_FIELDS } from '../../screens/contract-values';
import { curvePath } from '../../screens/catalogue';
import { FailureMessage } from '../screens/failure';
import { useCommand, useQuery } from '../screens/use-command';
import { CurveFormDialog } from './curve-form';
import { ItemFormDialog } from './item-form';
import { useCatalogueText } from './use-spec-text';

/**
 * The item sheet: an item's details, its specifications and, for a pump, its curve as a table
 * and a line. Someone with `catalogue.write` edits the item or its curve, or stops selling it.
 */
export function ItemSheet({
  itemId,
  canWrite,
  returnFocusTo,
  onClose,
  onChanged,
}: {
  itemId: string;
  canWrite: boolean;
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onChanged: (item: ItemDto) => void;
}) {
  const t = useTranslations('catalogue');
  const common = useTranslations('common');
  const text = useCatalogueText();
  const { load, pending, failure } = useQuery<ItemDetailDto>();
  const [item, setItem] = useState<ItemDetailDto | undefined>();
  const [dialog, setDialog] = useState<'edit' | 'curve' | 'archive' | undefined>();
  const buttons = {
    edit: useRef<HTMLButtonElement>(null),
    curve: useRef<HTMLButtonElement>(null),
    archive: useRef<HTMLButtonElement>(null),
  };

  useEffect(() => {
    load(
      () => getItem({ itemId }),
      (loaded) => {
        setItem(loaded);
      },
    );
  }, [load, itemId]);

  function changed(next: ItemDetailDto) {
    setItem(next);
    onChanged(next);
  }

  const fields = item === undefined ? [] : ITEM_SPEC_FIELDS[item.category];

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        closeLabel={common('close')}
        returnFocusTo={returnFocusTo}
        className="w-[min(32rem,calc(100%-3rem))]"
      >
        {item === undefined ? (
          <>
            <SheetHeader>
              <SheetTitle>{t('item.loading')}</SheetTitle>
            </SheetHeader>
            <FailureMessage failure={failure} />
            {pending ? (
              <div className="flex flex-col gap-3" aria-busy>
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : null}
          </>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle>{item.name}</SheetTitle>
              <SheetDescription>
                {item.sku} · {text.category(item.category)}
              </SheetDescription>
            </SheetHeader>
            {item.isActive ? null : (
              <p className="text-text-muted">
                <StatusBadge tone="neutral">{t('status.archived')}</StatusBadge>{' '}
                {t('item.archivedNote')}
              </p>
            )}
            {canWrite && item.isActive ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  ref={buttons.edit}
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setDialog('edit');
                  }}
                >
                  {t('item.edit')}
                </Button>
                {item.category === 'pump' ? (
                  <Button
                    ref={buttons.curve}
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setDialog('curve');
                    }}
                  >
                    {t('item.editCurve')}
                  </Button>
                ) : null}
                <Button
                  ref={buttons.archive}
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    setDialog('archive');
                  }}
                >
                  {t('item.archive')}
                </Button>
              </div>
            ) : null}
            <section aria-labelledby="item-details" className="flex flex-col gap-2">
              <h3 id="item-details" className="text-h3">
                {t('item.details')}
              </h3>
              <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-2">
                <Detail label={t('item.code')} value={item.sku} />
                <Detail label={t('item.category')} value={text.category(item.category)} />
                <Detail label={t('item.hsn')} value={item.hsn} />
                <Detail label={t('item.unit')} value={text.unit(item.unit)} />
                <Detail
                  label={t('item.serial')}
                  value={item.isSerialTracked ? common('yes') : common('no')}
                />
                {item.category === 'solar_module' ? (
                  <>
                    <Detail label={t('item.dcr')} value={item.isDcr ? common('yes') : common('no')} />
                    <Detail label={t('item.almm')} value={item.almmRef ?? common('notSet')} />
                  </>
                ) : null}
              </dl>
            </section>
            <section aria-labelledby="item-specs" className="flex flex-col gap-2">
              <h3 id="item-specs" className="text-h3">
                {t('item.specsHeading')}
              </h3>
              {fields.length === 0 ? (
                <p className="text-text-muted">{t('item.noSpecs')}</p>
              ) : (
                <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-2">
                  {fields.map((f) => {
                    const value = item.specs[f.key];
                    return (
                      <Detail
                        key={f.key}
                        label={text.specLabel(f.key)}
                        value={
                          value === undefined
                            ? t('item.specsMissing')
                            : text.specValue(f.key, value)
                        }
                      />
                    );
                  })}
                </dl>
              )}
            </section>
            {item.category === 'pump' ? <PumpCurve curve={item.curve} /> : null}
            {dialog === 'edit' ? (
              <ItemFormDialog
                item={item}
                returnFocusTo={() => [buttons.edit.current]}
                onClose={() => {
                  setDialog(undefined);
                }}
                onSaved={(saved) => {
                  setDialog(undefined);
                  changed(saved);
                }}
              />
            ) : null}
            {dialog === 'curve' ? (
              <CurveFormDialog
                item={item}
                returnFocusTo={() => [buttons.curve.current]}
                onClose={() => {
                  setDialog(undefined);
                }}
                onSaved={(saved) => {
                  setDialog(undefined);
                  changed(saved);
                }}
              />
            ) : null}
            {dialog === 'archive' ? (
              <ArchiveItemDialog
                item={item}
                returnFocusTo={() => [buttons.archive.current]}
                onClose={() => {
                  setDialog(undefined);
                }}
                onDone={(archived) => {
                  setDialog(undefined);
                  changed({ ...item, ...archived });
                }}
              />
            ) : null}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </>
  );
}

/** A pump's curve: the points as a table, and the same points as a line drawn with tokens. */
function PumpCurve({ curve }: { curve: PumpCurvePointDto[] }) {
  const t = useTranslations('catalogue.item');
  const path = curvePath(curve, { width: 320, height: 160, inset: 8 });
  return (
    <section aria-labelledby="item-curve" className="flex flex-col gap-2">
      <h3 id="item-curve" className="text-h3">
        {t('curveHeading')}
      </h3>
      <p className="text-text-muted">{t('curveIntro')}</p>
      {curve.length === 0 || path === undefined ? (
        <p className="text-text-muted">{t('curveEmpty')}</p>
      ) : (
        <>
          <svg
            viewBox="0 0 320 160"
            role="img"
            aria-label={t('curveChart', {
              highest: path.highestHead,
              lowest: path.lowestHead,
              least: path.leastFlow,
              most: path.mostFlow,
            })}
            className="bg-surface-2 border-border h-40 w-full rounded-md border"
          >
            <line x1="8" y1="152" x2="312" y2="152" className="stroke-border" strokeWidth="1" />
            <line x1="8" y1="8" x2="8" y2="152" className="stroke-border" strokeWidth="1" />
            <polyline
              points={path.points}
              fill="none"
              className="stroke-chart-1"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            {path.dots.map((d) => (
              <circle key={`${String(d.x)}-${String(d.y)}`} cx={d.x} cy={d.y} r="3" className="fill-chart-1" />
            ))}
          </svg>
          <table className="w-full text-left">
            <caption className="sr-only">{t('curveCaption')}</caption>
            <thead className="text-text-muted">
              <tr>
                <th scope="col" className="py-1 font-medium">
                  {t('flow')}
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  {t('head')}
                </th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {curve.map((p) => (
                <tr key={p.flowLph} className="border-border border-t">
                  <td className="py-1">{Number(p.flowLph).toLocaleString('en-IN')}</td>
                  <td className="py-1 text-right">{Number(p.headM).toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function ArchiveItemDialog({
  item,
  returnFocusTo,
  onClose,
  onDone,
}: {
  item: ItemDetailDto;
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onDone: (archived: ItemDto) => void;
}) {
  const t = useTranslations('catalogue.archiveItem');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(archiveItem);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={common('close')} returnFocusTo={returnFocusTo}>
        <DialogHeader>
          <DialogTitle>{t('title', { name: item.name })}</DialogTitle>
          <DialogDescription>{t('intro')}</DialogDescription>
        </DialogHeader>
        <FailureMessage failure={failure} />
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {common('cancel')}
          </Button>
          <Button
            variant="danger"
            pending={pending}
            onClick={() => {
              run({ itemId: item.id }, (archived) => {
                toast.success(t('done', { name: item.name }));
                onDone(archived);
              });
            }}
          >
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
