import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listKits } from '../../../../actions/catalogue';
import { readCoversAllCompanies } from '../../../../actions/pricing';
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
  // Products are shared: changes are offered only while the person acts for every company.
  const covers = await readCoversAllCompanies();
  const holdsWrite = can('catalogue.write', 'entity');
  const canWrite = holdsWrite && covers.ok && covers.data;
  return (
    <Page title={t('title')} description={t('intro')}>
      <CatalogueTabs
        current="kits"
        label={t('sections')}
        items={t('itemsTab')}
        kits={t('kitsTab')}
      />
      {holdsWrite && !canWrite ? (
        <p role="note" className="bg-info-soft border-border rounded-md border px-4 py-3">
          {t('groupNote')}
        </p>
      ) : null}
      {first.ok ? (
        <KitsScreen initialPage={first.data} canWrite={canWrite} />
      ) : (
        <FailureMessage failure={firstFailure(first)} />
      )}
    </Page>
  );
}
