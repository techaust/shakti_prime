import type { ItemPageDto, KitPageDto } from '@shakti/contracts';
import { cn } from '@shakti/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { listItems, listKits } from '../../../actions/catalogue';
import { ItemsScreen } from '../../../components/catalogue/items-screen';
import { KitsScreen } from '../../../components/catalogue/kits-screen';
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
 * Catalogue (INV-01, INV-03): the items and kits every company sells, a tab each. Anyone who
 * reads prices opens it; adding and changing items needs `catalogue.write`, which the commands
 * check as well.
 */
export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { can } = await screenAccess(navRequires('catalogue'));
  const t = await getTranslations('catalogue');
  const view = (await searchParams).view === 'kits' ? 'kits' : 'items';
  const canWrite = can('catalogue.write', 'entity');

  const tabs = (
    <nav aria-label={t('sections')} className="border-border flex gap-1 border-b">
      {(['items', 'kits'] as const).map((tab) => (
        <Link
          key={tab}
          href={tab === 'items' ? '/catalogue' : '/catalogue?view=kits'}
          aria-current={view === tab ? 'page' : undefined}
          className={cn(
            'text-text-muted hover:text-text -mb-px rounded-t-md border-b-2 border-transparent px-3 py-2 font-medium',
            view === tab && 'border-accent text-text',
          )}
        >
          {tab === 'items' ? t('itemsTab') : t('kitsTab')}
        </Link>
      ))}
    </nav>
  );

  let content;
  if (view === 'items') {
    const first = await listItems({ limit: 50 });
    content = first.ok ? (
      <ItemsScreen initialPage={first.data satisfies ItemPageDto} canWrite={canWrite} />
    ) : (
      <FailureMessage failure={firstFailure(first)} />
    );
  } else {
    const first = await listKits({ limit: 50 });
    content = first.ok ? (
      <KitsScreen initialPage={first.data satisfies KitPageDto} canWrite={canWrite} />
    ) : (
      <FailureMessage failure={firstFailure(first)} />
    );
  }

  return (
    <Page title={t('title')} description={t('intro')}>
      {tabs}
      {content}
    </Page>
  );
}
