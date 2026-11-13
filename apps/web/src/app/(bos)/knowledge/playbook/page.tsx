import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listPlaybook, loadPlaybookReview } from '../../../../actions/playbook';
import { PlaybookScreen } from '../../../../components/knowledge/playbook-screen';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { navRequires } from '../../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../../screens/access';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('knowledge-playbook'),
    (await getTranslations('playbook'))('title'),
  );
}

/**
 * The Playbook (docs/03-roadmap-appendix/phase2.md §5.4, PRD AI-01): the rules by status, kind and
 * company, and the review of one beside the passage it comes from and the approved rules it was
 * compared with. An Executive or GM drafts, edits and retires drafts; an Executive approves, retires
 * an approved rule and settles a clash.
 */
export default async function PlaybookPage() {
  const screen = await screenAccess(navRequires('knowledge-playbook'));
  const { principal, access, activeEntityId, can } = screen;
  const t = await getTranslations('playbook');
  const names = companyNames(access);
  const companies = principal.entityIds.map((id) => ({ id, name: names[id] ?? String(id) }));
  const page = await listPlaybook({});
  const first = page.ok ? page.data.directives[0] : undefined;
  const review =
    first === undefined ? undefined : await loadPlaybookReview({ directiveId: first.id });
  return (
    <Page title={t('title')} description={t('intro')} width="full">
      {page.ok ? (
        <PlaybookScreen
          initial={page.data}
          initialReview={review?.ok === true ? review.data : undefined}
          companies={companies}
          allCompanies={activeEntityId === undefined}
          canApprove={can('knowledge.playbook.approve', 'all')}
          readsManagement={can('knowledge.vault.read.management', 'all')}
        />
      ) : (
        <FailureMessage failure={firstFailure(page)} />
      )}
    </Page>
  );
}
