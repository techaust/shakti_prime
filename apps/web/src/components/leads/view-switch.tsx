import { Button } from '@shakti/ui';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

/**
 * List or Board: two ways to see the same leads. The board is a view of the Leads screen, not a
 * screen of its own, so the menu keeps one Leads entry and this switch sits in the page's actions.
 */
export async function LeadsViewSwitch({ current }: { current: 'list' | 'board' }) {
  const t = await getTranslations('leads');
  const link = (view: 'list' | 'board') => (
    <Button asChild variant={current === view ? 'secondary' : 'ghost'}>
      <Link
        href={view === 'list' ? '/leads' : '/leads/board'}
        aria-current={current === view ? 'page' : undefined}
      >
        {view === 'list' ? t('viewList') : t('viewBoard')}
      </Link>
    </Button>
  );
  return (
    <nav aria-label={t('viewLabel')} className="flex items-center gap-1">
      {link('list')}
      {link('board')}
    </nav>
  );
}
