import { hasGrant } from '@shakti/contracts';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listHubs } from '../../../../actions/inventory';
import { HubsScreen } from '../../../../components/inventory/hubs-screen';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { navRequires } from '../../../../nav';
import { screenAccess, screenTitle } from '../../../../screens/access';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('inventory-hubs'),
    (await getTranslations('inventory.hubs'))('title'),
  );
}

/**
 * Inventory › Hubs and bins (docs/03-roadmap-appendix/phase3.md §5): the group's hubs with their
 * bins; an Executive adds, edits and archives them, and a stock handler prints their labels (Q1).
 */
export default async function HubsPage() {
  const { principal, activeEntityId } = await screenAccess(navRequires('inventory-hubs'));
  const t = await getTranslations('inventory.hubs');
  const hubs = await listHubs({});
  return (
    <Page title={t('title')} description={t('intro')}>
      {hubs.ok ? (
        <HubsScreen
          initial={hubs.data}
          canEdit={hasGrant(principal.permissions, 'inventory.stock.adjust', 'all')}
          labelsFor={
            // A bin is the group's: its labels are asked for in the company the caller acts in.
            hasGrant(principal.permissions, 'inventory.stock.move', 'entity')
              ? (activeEntityId ?? principal.entityIds[0] ?? null)
              : null
          }
        />
      ) : (
        <FailureMessage failure={firstFailure(hubs)} />
      )}
    </Page>
  );
}
