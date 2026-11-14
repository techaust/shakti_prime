import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listAskConversations } from '../../../actions/ask';
import { AskScreen } from '../../../components/ask/ask-screen';
import { FailureMessage } from '../../../components/screens/failure';
import { Page } from '../../../components/shell/page';
import { navRequires } from '../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../screens/access';
import { firstFailure } from '../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('ask'), (await getTranslations('ask'))('title'));
}

/**
 * Ask the Business (docs/03-roadmap-appendix/phase2.md §6.5, PRD AI-02): the person's own
 * conversations and a question box; each answer shows the records it comes from.
 */
export default async function AskPage() {
  const { access } = await screenAccess(navRequires('ask'));
  const t = await getTranslations('ask');
  const page = await listAskConversations({});
  return (
    <Page title={t('title')} description={t('intro')}>
      {page.ok ? (
        <AskScreen initial={page.data} companyNames={companyNames(access)} />
      ) : (
        <FailureMessage failure={firstFailure(page)} />
      )}
    </Page>
  );
}
