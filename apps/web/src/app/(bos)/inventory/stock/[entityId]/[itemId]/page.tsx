import { hasGrant, type ExtendAuthority } from '@shakti/contracts';
import { Button } from '@shakti/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getStockCard, listHubs } from '../../../../../../actions/inventory';
import { listItemBackorders, listReservations } from '../../../../../../actions/reservations';
import {
  BackordersPanel,
  ReservationsPanel,
} from '../../../../../../components/inventory/reservations-panel';
import { StockCardScreen } from '../../../../../../components/inventory/stock-card-screen';
import { FailureMessage } from '../../../../../../components/screens/failure';
import { Page } from '../../../../../../components/shell/page';
import { navRequires } from '../../../../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../../../../screens/access';
import { firstFailure } from '../../../../../../screens/result';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface Params {
  entityId: string;
  itemId: string;
}

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('inventory-stock'),
    (await getTranslations('inventory.card'))('title'),
  );
}

/**
 * An item's stock card in one company (docs/03-roadmap-appendix/phase3.md §6.2): what each hub
 * holds and every movement newest first, with Adjust stock, Move between bins and Reverse for
 * those who hold the grants. An address that names no company or item of the caller's shows the
 * not-found screen.
 */
export default async function StockCardPage({ params }: { params: Promise<Params> }) {
  const { principal, access } = await screenAccess(navRequires('inventory-stock'));
  const { entityId: rawEntityId, itemId } = await params;
  const entityId = Number(rawEntityId);
  if (
    !Number.isInteger(entityId) ||
    !principal.entityIds.includes(entityId) ||
    !UUID.test(itemId)
  ) {
    notFound();
  }
  const [card, hubs, reservations, backorders] = await Promise.all([
    getStockCard({ entityId, itemId, limit: 50 }),
    listHubs({}),
    // H2: the stock held for orders, and the orders waiting for the item.
    listReservations({ entityId, itemId }),
    listItemBackorders({ entityId, itemId }),
  ]);
  const can = (key: 'inventory.stock.adjust' | 'sales.order.cancel') =>
    hasGrant(principal.permissions, key, 'entity');
  const extendAuthority: ExtendAuthority | null = can('inventory.stock.adjust')
    ? 'stock'
    : can('sales.order.cancel')
      ? 'order'
      : null;
  if (!card.ok && card.error === 'stock_item_missing') notFound();
  const t = await getTranslations('inventory.card');
  const company = companyNames(access)[entityId] ?? '';
  return (
    <Page
      title={card.ok ? card.data.item.name : t('title')}
      description={t('intro', { company })}
      actions={
        <Button asChild variant="secondary">
          <Link href={`/inventory/stock?company=${String(entityId)}` as Route}>{t('back')}</Link>
        </Button>
      }
    >
      {card.ok && hubs.ok ? (
        <StockCardScreen
          key={card.data.item.id}
          initial={card.data}
          hubs={hubs.data.hubs}
          canAdjust={hasGrant(principal.permissions, 'inventory.stock.adjust', 'entity')}
          canMove={hasGrant(principal.permissions, 'inventory.stock.move', 'entity')}
        />
      ) : (
        <FailureMessage failure={firstFailure(card, hubs)} />
      )}
      {card.ok && hubs.ok && reservations.ok ? (
        <ReservationsPanel
          entityId={entityId}
          scope={{ itemId }}
          initial={reservations.data}
          hubs={hubs.data.hubs}
          extendAuthority={extendAuthority}
          canAdjust={can('inventory.stock.adjust')}
        />
      ) : null}
      {card.ok && backorders.ok ? <BackordersPanel list={backorders.data} /> : null}
    </Page>
  );
}
