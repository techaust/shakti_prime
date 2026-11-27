'use client';

import type { SerialDto } from '@shakti/contracts';
import { Button, type ReturnFocusTo } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { formatDate } from '../../screens/format';
import { stockCardHref } from '../../screens/inventory';
import { Page } from '../shell/page';
import { MovementsTable } from './movements-table';
import { RaiseClaimButton } from './raise-claim-button';
import { useSerialStateText } from './use-inventory-text';

// Loaded when a label is asked for, so the page's own script stays inside its budget.
const LabelsDialog = dynamic(() => import('./labels-dialog').then((m) => m.LabelsDialog));

/**
 * A serial: where it is, its warranty dates and every movement, newest first. A stock handler
 * (`inventory.stock.move` for the company) prints its label (Q1): a first one, for a serial that
 * came in without a receipt, or one again, with why. A holder of `inventory.warranty.write` raises
 * a warranty claim on a serial with its customer (R3).
 */
export function SerialScreen({
  serial,
  company,
  canPrint,
  canRaiseClaim = false,
}: {
  serial: SerialDto;
  company: string;
  canPrint: boolean;
  /** R3: the caller raises warranty claims, and the serial is with its customer. */
  canRaiseClaim?: boolean;
}) {
  const t = useTranslations('inventory.serial');
  const labels = useTranslations('inventory.labels');
  const [printing, setPrinting] = useState<
    { mode: 'print' | 'reprint'; returnFocusTo: ReturnFocusTo } | undefined
  >();
  const printButton = useRef<HTMLButtonElement>(null);
  const reprintButton = useRef<HTMLButtonElement>(null);
  const state = useSerialStateText();
  const facts: [string, string][] = [
    [t('item'), `${serial.item.name} (${serial.item.sku})`],
    [t('company'), company],
    [t('state'), state(serial.state)],
    [
      t('bin'),
      serial.bin === null
        ? t('noBin')
        : t('binIn', { bin: serial.bin.code, hub: serial.bin.hubCode }),
    ],
    [
      t('warrantyUntil'),
      serial.warrantyUntil === null ? t('notSet') : formatDate(serial.warrantyUntil),
    ],
    [
      t('supplierWarrantyUntil'),
      serial.supplierWarrantyUntil === null
        ? t('notSet')
        : formatDate(serial.supplierWarrantyUntil),
    ],
  ];
  return (
    <Page
      title={t('heading', { serial: serial.serialNo })}
      description={t('intro')}
      width="detail"
      actions={
        <>
          {canRaiseClaim && serial.state === 'with_customer' ? (
            <RaiseClaimButton
              entityId={serial.entityId}
              on={{ kind: 'serial', serialId: serial.id, serialNo: serial.serialNo }}
            />
          ) : null}
          {canPrint ? (
            <>
              <Button
                ref={printButton}
                variant="secondary"
                onClick={() => {
                  setPrinting({ mode: 'print', returnFocusTo: () => [printButton.current] });
                }}
              >
                {labels('firstLabel')}
              </Button>
              <Button
                ref={reprintButton}
                variant="secondary"
                onClick={() => {
                  setPrinting({ mode: 'reprint', returnFocusTo: () => [reprintButton.current] });
                }}
              >
                {labels('reprintLabel')}
              </Button>
            </>
          ) : null}
          <Button asChild variant="secondary">
            <Link href={stockCardHref(serial.entityId, serial.item.id)}>{t('card')}</Link>
          </Button>
        </>
      }
    >
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div key={label} className="flex flex-col">
            <dt className="text-text-muted text-sm">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <section className="flex flex-col gap-2" aria-labelledby="serial-movements">
        <h2 id="serial-movements" className="text-lg font-semibold">
          {t('movements')}
        </h2>
        <MovementsTable entityId={serial.entityId} movements={serial.movements} />
      </section>
      {printing === undefined ? null : (
        <LabelsDialog
          mode={printing.mode}
          entityId={serial.entityId}
          labelKind="serial"
          ids={[serial.id]}
          title={
            printing.mode === 'print'
              ? labels('printSerialTitle', { serial: serial.serialNo })
              : labels('reprintSerialTitle', { serial: serial.serialNo })
          }
          intro={
            printing.mode === 'print' ? labels('printSerialIntro') : labels('reprintSerialIntro')
          }
          returnFocusTo={printing.returnFocusTo}
          onClose={() => {
            setPrinting(undefined);
          }}
        />
      )}
    </Page>
  );
}
