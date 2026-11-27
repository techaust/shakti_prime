'use client';

import type { SerialDto } from '@shakti/contracts';
import { Button } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { formatDate } from '../../screens/format';
import { stockCardHref } from '../../screens/inventory';
import { Page } from '../shell/page';
import { MovementsTable } from './movements-table';
import { RaiseClaimButton } from './raise-claim-button';
import { useSerialStateText } from './use-inventory-text';

/** A serial: where it is, its warranty dates and every movement, newest first. */
export function SerialScreen({
  serial,
  company,
  canRaiseClaim = false,
}: {
  serial: SerialDto;
  company: string;
  /** R3: the caller raises warranty claims, and the serial is with its customer. */
  canRaiseClaim?: boolean;
}) {
  const t = useTranslations('inventory.serial');
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
    </Page>
  );
}
