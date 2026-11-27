import { hasGrant } from '@shakti/contracts';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { getSerial } from '../../../../../actions/inventory';
import { SerialScreen } from '../../../../../components/inventory/serial-screen';
import { FailureMessage } from '../../../../../components/screens/failure';
import { Page } from '../../../../../components/shell/page';
import { navRequires } from '../../../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../../../screens/access';
import { companyParam } from '../../../../../screens/customers';
import { firstFailure } from '../../../../../screens/result';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('inventory-stock'),
    (await getTranslations('inventory.serial'))('title'),
  );
}

/**
 * A serial's page (docs/03-roadmap-appendix/phase3.md §6.2): where it is, its warranty and every
 * movement newest first. `?company=` names the company that holds it; a serial the caller may
 * not read shows the not-found screen.
 */
export default async function SerialPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { principal, access, activeEntityId } = await screenAccess(navRequires('inventory-stock'));
  const { id } = await params;
  const asked = companyParam((await searchParams).company);
  const entityId = asked ?? activeEntityId ?? principal.entityIds[0];
  if (entityId === undefined || !principal.entityIds.includes(entityId) || !UUID.test(id)) {
    notFound();
  }
  const serial = await getSerial({ entityId, serialId: id });
  if (!serial.ok && serial.error === 'stock_serial_unknown') notFound();
  const t = await getTranslations('inventory.serial');
  return serial.ok ? (
    <SerialScreen
      serial={serial.data}
      company={companyNames(access)[entityId] ?? ''}
      canRaiseClaim={hasGrant(principal.permissions, 'inventory.warranty.write', 'entity')}
    />
  ) : (
    <Page title={t('title')} width="detail">
      <FailureMessage failure={firstFailure(serial)} />
    </Page>
  );
}
