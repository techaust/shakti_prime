'use client';

import type { SerialDto } from '@shakti/contracts';
import { Button, type ReturnFocusTo } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { formatDate } from '../../screens/format';
import { stockCardHref } from '../../screens/inventory';
import { Page } from '../shell/page';
import { LabelsDialog } from './labels-dialog';
import { MovementsTable } from './movements-table';
import { useSerialStateText } from './use-inventory-text';

/**
 * A serial: where it is, its warranty dates and every movement, newest first. A stock handler
 * (`inventory.stock.move` for the company) prints its label again, with why (Q1).
 */
export function SerialScreen({
  serial,
  company,
  canReprint,
}: {
  serial: SerialDto;
  company: string;
  canReprint: boolean;
}) {
  const t = useTranslations('inventory.serial');
  const labels = useTranslations('inventory.labels');
  const [reprinting, setReprinting] = useState<{ returnFocusTo: ReturnFocusTo } | undefined>();
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
          {canReprint ? (
            <Button
              ref={reprintButton}
              variant="secondary"
              onClick={() => {
                setReprinting({ returnFocusTo: () => [reprintButton.current] });
              }}
            >
              {labels('reprintLabel')}
            </Button>
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
      {reprinting === undefined ? null : (
        <LabelsDialog
          mode="reprint"
          entityId={serial.entityId}
          labelKind="serial"
          ids={[serial.id]}
          title={labels('reprintSerialTitle', { serial: serial.serialNo })}
          intro={labels('reprintSerialIntro')}
          returnFocusTo={reprinting.returnFocusTo}
          onClose={() => {
            setReprinting(undefined);
          }}
        />
      )}
    </Page>
  );
}
