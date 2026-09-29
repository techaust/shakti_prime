import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listKits } from '../../../../actions/catalogue';
import { CatalogueTabs } from '../../../../components/catalogue/catalogue-tabs';
import { KitsScreen } from '../../../../components/catalogue/kits-screen';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { navRequires } from '../../../../nav';
import { screenAccess, screenTitle } from '../../../../screens/access';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('catalogue'), (await getTranslations('catalogue'))('title'));
}

/**
 * Catalogue › Kits (INV-03): the kits every company sells, each a bundle of catalogue items sold
 * as one line. Opened like the items page; changes need `catalogue.write`.
 */
export default async function CatalogueKitsPage() {
  const { can } = await screenAccess(navRequires('catalogue'));
  const t = await getTranslations('catalogue');

  const first = await listKits({ limit: 50 });
  return (
    <Page title={t('title')} description={t('intro')}>
      <CatalogueTabs
        current="kits"
        label={t('sections')}
        items={t('itemsTab')}
        kits={t('kitsTab')}
      />
      {first.ok ? (
        <KitsScreen initialPage={first.data} canWrite={can('catalogue.write', 'entity')} />
      ) : (
        <FailureMessage failure={firstFailure(first)} />
      )}
    </Page>
  );
}
