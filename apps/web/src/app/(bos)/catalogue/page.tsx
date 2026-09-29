import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listItems } from '../../../actions/catalogue';
import { CatalogueTabs } from '../../../components/catalogue/catalogue-tabs';
import { ItemsScreen } from '../../../components/catalogue/items-screen';
import { FailureMessage } from '../../../components/screens/failure';
import { Page } from '../../../components/shell/page';
import { navRequires } from '../../../nav';
import { screenAccess, screenTitle } from '../../../screens/access';
import { firstFailure } from '../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('catalogue'), (await getTranslations('catalogue'))('title'));
}

/**
 * Catalogue › Items (INV-01): the items every company sells; the kits have a page of their own
 * beside it, so each loads only its own grid. Anyone who reads prices opens it; adding and
 * changing items needs `catalogue.write`, which the commands check as well.
 */
export default async function CataloguePage() {
  const { can } = await screenAccess(navRequires('catalogue'));
  const t = await getTranslations('catalogue');

  const first = await listItems({ limit: 50 });
  return (
    <Page title={t('title')} description={t('intro')}>
      <CatalogueTabs
        current="items"
        label={t('sections')}
        items={t('itemsTab')}
        kits={t('kitsTab')}
      />
      {first.ok ? (
        <ItemsScreen initialPage={first.data} canWrite={can('catalogue.write', 'entity')} />
      ) : (
        <FailureMessage failure={firstFailure(first)} />
      )}
    </Page>
  );
}
