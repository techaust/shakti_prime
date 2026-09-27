import type { PricePageDto } from '@shakti/contracts';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listPriceLists, listPrices } from '../../../actions/pricing';
import { PriceMasterScreen } from '../../../components/pricing/price-master-screen';
import { FailureMessage } from '../../../components/screens/failure';
import { Screen } from '../../../components/screens/screen';
import { companyNames, screenAccess } from '../../../screens/access';
import { firstFailure } from '../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('priceMaster'))('title') };
}

/**
 * Price Master (SAL-01): the price lists the caller can read and the selling prices on one of
 * them, a page at a time. Only selling prices: no cost figure is read for this screen.
 */
export default async function PriceMasterPage() {
  const { access, can } = await screenAccess({ key: 'pricing.read', scope: 'entity' });
  const t = await getTranslations('priceMaster');
  const lists = await listPriceLists();
  if (!lists.ok) {
    return (
      <Screen title={t('title')} intro={t('intro')}>
        <FailureMessage failure={firstFailure(lists)} />
      </Screen>
    );
  }
  const first = lists.data.find((l) => l.open) ?? lists.data[0];
  let initialPage: PricePageDto | undefined;
  if (first !== undefined) {
    const prices = await listPrices({ priceListId: first.id, limit: 50 });
    if (!prices.ok) {
      return (
        <Screen title={t('title')} intro={t('intro')}>
          <FailureMessage failure={firstFailure(prices)} />
        </Screen>
      );
    }
    initialPage = prices.data;
  }
  return (
    <Screen title={t('title')} intro={t('intro')}>
      <PriceMasterScreen
        lists={lists.data}
        companies={companyNames(access)}
        initialListId={first?.id}
        initialPage={initialPage}
        canSetPrices={can('pricing.write', 'all')}
      />
    </Screen>
  );
}
