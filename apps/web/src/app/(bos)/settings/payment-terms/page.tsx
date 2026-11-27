import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listPaymentTerms } from '../../../../actions/finance';
import { PaymentTermsScreen } from '../../../../components/finance/payment-terms-screen';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { navRequires } from '../../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../../screens/access';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('settings-payment-terms'),
    (await getTranslations('finance'))('terms.title'),
  );
}

/**
 * Settings › Payment terms (`finance.payment.write` for every company, docs/03-roadmap-appendix/
 * phase5.md §6.1, question 6 (a)): each company's terms per kind of order, published by the
 * Executive as a new version that orders confirmed afterwards follow.
 */
export default async function PaymentTermsPage() {
  const { access, principal } = await screenAccess(navRequires('settings-payment-terms'));
  const t = await getTranslations('finance');
  const names = companyNames(access);
  const companies = principal.entityIds.map((id) => ({ id, name: names[id] ?? String(id) }));
  const first = companies[0]?.id ?? 1;
  const terms = await listPaymentTerms({ entityId: first });
  return (
    <Page title={t('terms.title')} description={t('terms.description')} width="detail">
      {terms.ok ? (
        <PaymentTermsScreen companies={companies} initial={terms.data} />
      ) : (
        <FailureMessage failure={firstFailure(terms)} />
      )}
    </Page>
  );
}
