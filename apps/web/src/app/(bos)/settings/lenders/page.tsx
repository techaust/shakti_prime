import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listLenders } from '../../../../actions/loans';
import { LendersScreen } from '../../../../components/loans/lenders-screen';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { navRequires } from '../../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../../screens/access';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('settings-lenders'),
    (await getTranslations('loans'))('lenders.title'),
  );
}

/**
 * Settings › Lenders (`admin.entities.write`, docs/03-roadmap-appendix/phase4.md §6.2): each
 * company's list of the banks and schemes its customers borrow from, which the loan form offers.
 */
export default async function LendersPage() {
  const { access, principal } = await screenAccess(navRequires('settings-lenders'));
  const t = await getTranslations('loans');
  const names = companyNames(access);
  const companies = principal.entityIds.map((id) => ({ id, name: names[id] ?? String(id) }));
  const first = companies[0]?.id ?? 1;
  const lenders = await listLenders({ entityId: first });
  return (
    <Page title={t('lenders.title')} description={t('lenders.intro')} width="detail">
      {lenders.ok ? (
        <LendersScreen companies={companies} initialCompany={first} initial={lenders.data} />
      ) : (
        <FailureMessage failure={firstFailure(lenders)} />
      )}
    </Page>
  );
}
