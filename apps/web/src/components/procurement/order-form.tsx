'use client';

import type { ItemVendorDto, PurchaseOrderRefDto } from '@shakti/contracts';
import { Button, DateInput, Field, Input, Select, Textarea, toast } from '@shakti/ui';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type SyntheticEvent } from 'react';
import { getVendor } from '../../actions/procurement';
import { createPurchaseOrder, updatePurchaseOrder } from '../../actions/purchase-orders';
import { FailureMessage } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand, useQuery } from '../screens/use-command';

/** A line as the form keeps it while the person writes. */
export interface DraftLine {
  key: string;
  itemId: string;
  qty: string;
  /** Typed rate; empty keeps the line's rate (on a change) or leaves it for later. */
  rate: string;
  fromQuote: boolean;
}

const QTY = /^\d{1,9}(\.\d{1,3})?$/;
const RATE = /^\d{1,10}(\.\d{1,4})?$/;

/**
 * Drafts a purchase order, or changes a draft (docs/03-roadmap-appendix/phase3.md §7.2): the
 * vendor and the hub goods go to, the expected date, notes, and lines of the items the vendor
 * supplies with their quantities in the purchase unit. A person who reads supplier rates types a
 * rate or takes the vendor's current quote; anyone else leaves the rates to one who does. The
 * amounts and the tax are worked out on the server, never here.
 */
export function OrderForm({
  entityId,
  orderId,
  vendors,
  hubs,
  canRate,
  initial,
}: {
  entityId: number;
  /** The draft being changed; none for a new order. */
  orderId?: string;
  vendors: readonly { id: string; name: string }[];
  hubs: readonly { id: string; name: string }[];
  canRate: boolean;
  initial?: {
    vendorId: string;
    hubId: string;
    expectedAt: string | null;
    notes: string | null;
    lines: DraftLine[];
  };
}) {
  const t = useTranslations('procurement.orderForm');
  const router = useRouter();
  const create = useCommand(createPurchaseOrder);
  const update = useCommand(updatePurchaseOrder);
  const command = orderId === undefined ? create : update;
  const [vendorId, setVendorId] = useState(initial?.vendorId ?? '');
  const [items, setItems] = useState<ItemVendorDto[]>([]);
  const [lines, setLines] = useState<DraftLine[]>(initial?.lines ?? []);
  const [problem, setProblem] = useState<string | undefined>();
  const vendorItems = useQuery<{ items: ItemVendorDto[] }>();
  const loadItems = vendorItems.load;

  // The items the chosen vendor supplies (U1's links), the only ones an order of it lists.
  useEffect(() => {
    if (vendorId === '') return;
    loadItems(
      () => getVendor({ vendorId }),
      (sheet) => {
        setItems(sheet.items);
      },
    );
  }, [vendorId, loadItems]);

  const itemName = (id: string) => {
    const found = items.find((i) => i.itemId === id);
    return found === undefined ? '' : `${found.itemName} (${found.sku})`;
  };

  function setLine(key: string, change: Partial<DraftLine>) {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...change } : l)));
  }

  function addLine(itemId: string) {
    if (itemId === '' || lines.some((l) => l.itemId === itemId)) return;
    setLines((current) => [
      ...current,
      { key: crypto.randomUUID(), itemId, qty: '1', rate: '', fromQuote: false },
    ]);
  }

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    if (lines.length === 0) {
      setProblem(t('linesMissing'));
      return;
    }
    if (lines.some((l) => !QTY.test(l.qty.trim()) || Number(l.qty) <= 0)) {
      setProblem(t('qtyWrong'));
      return;
    }
    if (canRate && lines.some((l) => l.rate.trim() !== '' && !RATE.test(l.rate.trim()))) {
      setProblem(t('rateWrong'));
      return;
    }
    setProblem(undefined);
    const expected = formText(data, 'expectedAt');
    const notes = formText(data, 'notes');
    const payloadLines = lines.map((l) => ({
      itemId: l.itemId,
      qty: l.qty.trim(),
      ...(canRate && l.fromQuote ? { rateFromQuote: true } : {}),
      ...(canRate && !l.fromQuote && l.rate.trim() !== '' ? { rate: l.rate.trim() } : {}),
    }));
    const done = (ref: PurchaseOrderRefDto) => {
      toast.success(
        orderId === undefined
          ? t('created', { number: ref.poNo })
          : t('saved', { number: ref.poNo }),
      );
      router.push(`/procurement/orders/${ref.id}` as Route);
    };
    if (orderId === undefined) {
      create.run(
        {
          entityId,
          vendorId: formText(data, 'vendorId'),
          deliverToWarehouseId: formText(data, 'hubId'),
          expectedAt: expected === '' ? null : expected,
          notes: notes === '' ? null : notes,
          lines: payloadLines,
        },
        done,
      );
    } else {
      update.run(
        {
          purchaseOrderId: orderId,
          deliverToWarehouseId: formText(data, 'hubId'),
          expectedAt: expected === '' ? null : expected,
          notes: notes === '' ? null : notes,
          lines: payloadLines,
        },
        done,
      );
    }
  }

  return (
    <form onSubmit={submit} className="flex max-w-4xl flex-col gap-5" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="order-vendor" label={t('vendor')}>
          <Select
            name="vendorId"
            required
            value={vendorId}
            disabled={orderId !== undefined}
            onChange={(e) => {
              setVendorId(e.target.value);
              setLines([]);
            }}
          >
            <option value="">{t('chooseVendor')}</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="order-hub" label={t('hub')}>
          <Select name="hubId" required defaultValue={initial?.hubId ?? hubs[0]?.id ?? ''}>
            {hubs.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="order-expected" label={t('expected')} helper={t('expectedHelper')}>
          <DateInput
            name="expectedAt"
            {...(initial?.expectedAt ? { defaultValue: initial.expectedAt } : {})}
          />
        </Field>
        <Field id="order-notes" label={t('notes')}>
          <Textarea name="notes" maxLength={1000} rows={2} defaultValue={initial?.notes ?? ''} />
        </Field>
      </div>

      <section aria-labelledby="order-lines" className="flex flex-col gap-3">
        <h2 id="order-lines" className="text-h3">
          {t('lines')}
        </h2>
        {vendorId === '' ? (
          <p className="text-text-muted text-sm">{t('vendorFirst')}</p>
        ) : items.length === 0 && !vendorItems.pending ? (
          <p className="text-text-muted text-sm">{t('noItems')}</p>
        ) : (
          <Field id="order-add-item" label={t('addItem')}>
            <Select
              value=""
              onChange={(e) => {
                addLine(e.target.value);
              }}
            >
              <option value="">{t('chooseItem')}</option>
              {items
                .filter((i) => !lines.some((l) => l.itemId === i.itemId))
                .map((i) => (
                  <option key={i.itemId} value={i.itemId}>
                    {`${i.itemName} (${i.sku})`}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        <ul className="flex flex-col gap-3">
          {lines.map((line, index) => (
            <li
              key={line.key}
              className="border-border grid gap-3 rounded-lg border p-3 sm:grid-cols-[2fr_1fr_1fr_auto]"
            >
              <p className="self-center font-medium">
                {itemName(line.itemId) || t('lineItem', { n: index + 1 })}
              </p>
              <Field id={`line-qty-${line.key}`} label={t('qty')}>
                <Input
                  inputMode="decimal"
                  value={line.qty}
                  onChange={(e) => {
                    setLine(line.key, { qty: e.target.value });
                  }}
                />
              </Field>
              {canRate ? (
                <Field
                  id={`line-rate-${line.key}`}
                  label={t('rate')}
                  helper={
                    line.fromQuote
                      ? t('rateFromQuote')
                      : orderId === undefined
                        ? undefined
                        : t('rateKept')
                  }
                >
                  <Input
                    inputMode="decimal"
                    value={line.rate}
                    disabled={line.fromQuote}
                    onChange={(e) => {
                      setLine(line.key, { rate: e.target.value });
                    }}
                  />
                </Field>
              ) : (
                <p className="text-text-muted self-center text-sm">{t('rateLater')}</p>
              )}
              <div className="flex flex-col justify-center gap-1">
                {canRate ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={line.fromQuote}
                      onChange={(e) => {
                        setLine(line.key, { fromQuote: e.target.checked, rate: '' });
                      }}
                    />
                    {t('useQuote')}
                  </label>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setLines((current) => current.filter((l) => l.key !== line.key));
                  }}
                  aria-label={t('removeLine', { item: itemName(line.itemId) })}
                >
                  {t('remove')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      {problem === undefined ? null : (
        <p role="alert" className="text-danger text-sm">
          {problem}
        </p>
      )}
      {command.failure === undefined ? null : <FailureMessage failure={command.failure} />}
      <div className="flex gap-2">
        <Button type="submit" pending={command.pending}>
          {orderId === undefined ? t('createSubmit') : t('saveSubmit')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            router.back();
          }}
        >
          {t('back')}
        </Button>
      </div>
    </form>
  );
}
