import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listInbox } from '../../../actions/agents';
import { InboxScreen } from '../../../components/agents/inbox-screen';
import { FailureMessage } from '../../../components/screens/failure';
import { Page } from '../../../components/shell/page';
import { navRequires } from '../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../screens/access';
import { firstFailure } from '../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('inbox'), (await getTranslations('agents'))('inbox.title'));
}

/**
 * The Agent Inbox (docs/03-roadmap-appendix/phase1.md §7.1, `agents.inbox.act`): the agents' suggestions waiting
 * for the caller's decision, in the companies being viewed. Approving runs the suggestion as the
 * caller, under the caller's own permissions.
 */
export default async function InboxPage() {
  const { access } = await screenAccess(navRequires('inbox'));
  const t = await getTranslations('agents');
  const page = await listInbox({ limit: 50 });
  return (
    <Page title={t('inbox.title')} description={t('inbox.intro')} width="detail">
      {page.ok ? (
        <InboxScreen initial={page.data} companies={companyNames(access)} />
      ) : (
        <FailureMessage failure={firstFailure(page)} />
      )}
    </Page>
  );
}
