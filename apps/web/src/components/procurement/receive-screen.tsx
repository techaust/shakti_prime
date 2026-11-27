'use client';

import type { GoodsReceiptRefDto, ReceiveGoodsDto } from '@shakti/contracts';
import { Button, DateInput, Field, Input, Select, toast } from '@shakti/ui';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type SyntheticEvent } from 'react';
import { postGoodsReceipt } from '../../actions/purchase-orders';
import { outstanding, plainQty, unitsToScan } from '../../screens/purchase-orders';
import { ScanField } from '../../screens/scan/scan-field';
import { newSerialResolver } from '../../screens/scan/scan-state';
import { FailureMessage } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';

interface LineEntry {
  qty: string;
  binId: string;
  serials: string[];
}

/**
 * Receive goods against a sent purchase order (docs/03-roadmap-appendix/phase3.md §7.2, INV-04):
 * line by line, the quantity in the purchase unit and the bin (the hub's receiving bin unless
 * another is chosen); every serial of a tracked item scanned with a handheld scanner or the
 * camera, or typed, until the count matches. No rate is on this screen: the receipt takes the
 * order's rate on the server.
 */
export function ReceiveScreen({ data }: { data: ReceiveGoodsDto }) {
  const t = useTranslations('procurement.receive');
  const units = useTranslations('procurement.units');
  const router = useRouter();
  const post = useCommand(postGoodsReceipt);
  const { order, bins } = data;
  const open = order.lines.filter((l) => outstanding(l.qty, l.qtyReceived) !== '0');
  const receivingBin = bins.find((b) => b.kind === 'receiving')?.id ?? bins[0]?.id ?? '';
  const [entries, setEntries] = useState<Record<string, LineEntry>>(() =>
    Object.fromEntries(
      open.map((l) => [
        l.id,
        { qty: outstanding(l.qty, l.qtyReceived), binId: receivingBin, serials: [] },
      ]),
    ),
  );
  const [problem, setProblem] = useState<string | undefined>();
  const resolvers = useMemo(
    () => Object.fromEntries(order.lines.map((l) => [l.id, newSerialResolver(l.serialPattern)])),
    [order.lines],
  );

  function setEntry(lineId: string, change: Partial<LineEntry>) {
    setEntries((current) => {
      const entry = current[lineId];
      return entry === undefined ? current : { ...current, [lineId]: { ...entry, ...change } };
    });
  }

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const lines = [];
    for (const line of open) {
      const entry = entries[line.id];
      if (entry === undefined || entry.qty.trim() === '' || Number(entry.qty) === 0) continue;
      const count = unitsToScan(entry.qty, line.unitFactor);
      if (line.isSerialTracked && (count === undefined || entry.serials.length !== count)) {
        setProblem(t('serialsShort', { item: line.itemName }));
        return;
      }
      lines.push({
        poLineId: line.id,
        qty: entry.qty.trim(),
        binId: entry.binId === '' ? null : entry.binId,
        ...(line.isSerialTracked ? { serialNos: entry.serials } : {}),
      });
    }
    if (lines.length === 0) {
      setProblem(t('nothing'));
      return;
    }
    setProblem(undefined);
    const invoiceNo = formText(data, 'vendorInvoiceNo');
    const invoiceDate = formText(data, 'vendorInvoiceDate');
    post.run(
      {
        purchaseOrderId: order.id,
        vendorInvoiceNo: invoiceNo === '' ? null : invoiceNo,
        vendorInvoiceDate: invoiceDate === '' ? null : invoiceDate,
        lines,
      },
      (receipt: GoodsReceiptRefDto) => {
        toast.success(t('posted', { number: receipt.grnNo }));
        router.push(`/procurement/orders/${order.id}` as Route);
        router.refresh();
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex max-w-4xl flex-col gap-5" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="receipt-invoice" label={t('invoiceNo')}>
          <Input name="vendorInvoiceNo" maxLength={40} autoComplete="off" />
        </Field>
        <Field id="receipt-invoice-date" label={t('invoiceDate')}>
          <DateInput name="vendorInvoiceDate" />
        </Field>
      </div>
      <ul className="flex flex-col gap-4">
        {open.map((line) => {
          const entry = entries[line.id];
          if (entry === undefined) return null;
          const count = unitsToScan(entry.qty, line.unitFactor);
          return (
            <li key={line.id} className="border-border flex flex-col gap-3 rounded-lg border p-4">
              <div>
                <p className="font-medium">{line.itemName}</p>
                <p className="text-text-muted text-sm">
                  {t('lineFacts', {
                    sku: line.sku,
                    ordered: plainQty(line.qty),
                    received: plainQty(line.qtyReceived),
                    unit: units(line.purchaseUnit),
                  })}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  id={`receive-qty-${line.id}`}
                  label={t('qty', { unit: units(line.purchaseUnit) })}
                >
                  <Input
                    inputMode="decimal"
                    value={entry.qty}
                    onChange={(e) => {
                      setEntry(line.id, { qty: e.target.value });
                    }}
                  />
                </Field>
                <Field id={`receive-bin-${line.id}`} label={t('bin')}>
                  <Select
                    value={entry.binId}
                    onChange={(e) => {
                      setEntry(line.id, { binId: e.target.value });
                    }}
                  >
                    {bins.map((b) => (
                      <option key={b.id} value={b.id}>
                        {t(`binKinds.${b.kind}`, { code: b.code })}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {line.isSerialTracked ? (
                <ScanField
                  id={`receive-serials-${line.id}`}
                  label={t('serials')}
                  helper={count === undefined ? t('wholeUnits') : t('serialsHelper', { count })}
                  codes={entry.serials}
                  onCodesChange={(serials) => {
                    setEntry(line.id, { serials });
                  }}
                  resolve={resolvers[line.id] ?? newSerialResolver(null)}
                  {...(count === undefined ? {} : { expected: count })}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      {problem === undefined ? null : (
        <p role="alert" className="text-danger text-sm">
          {problem}
        </p>
      )}
      {post.failure === undefined ? null : <FailureMessage failure={post.failure} />}
      <div className="flex gap-2">
        <Button type="submit" pending={post.pending}>
          {t('submit')}
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
