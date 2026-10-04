import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listCustomers } from '../../../actions/crm';
import { CustomersScreen } from '../../../components/customers/customers-screen';
import { FailureMessage } from '../../../components/screens/failure';
import { Page } from '../../../components/shell/page';
import { navRequires } from '../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../screens/access';
import { firstFailure } from '../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('customers'), (await getTranslations('customers'))('title'));
}

/** Customers: the customers the caller reads in the companies being viewed, by name. */
export default async function CustomersPage() {
  const { principal, access } = await screenAccess(navRequires('customers'));
  const t = await getTranslations('customers');
  const page = await listCustomers({ limit: 50 });
  return (
    <Page title={t('title')} description={t('intro')}>
      {page.ok ? (
        <CustomersScreen
          initial={page.data}
          companies={companyNames(access)}
          showCompany={principal.entityIds.length > 1}
        />
      ) : (
        <FailureMessage failure={firstFailure(page)} />
      )}
    </Page>
  );
}
