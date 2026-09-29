import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { loadAccount360 } from '../../../../actions/crm';
import { AccountScreen } from '../../../../components/customers/account-screen';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { navRequires } from '../../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../../screens/access';
import { companyParam } from '../../../../screens/customers';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('customers'), (await getTranslations('customers'))('title'));
}

/**
 * Account 360 (CRM-07): one customer as a company of the request deals with them. A customer the
 * caller may not read, or an address that names none, shows the not-found screen.
 */
export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { access } = await screenAccess(navRequires('customers'));
  const [{ accountId }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(accountId)) notFound();
  const entityId = companyParam(query.company);
  const view = await loadAccount360({
    accountId,
    ...(entityId === undefined ? {} : { entityId }),
  });
  if (!view.ok && view.error === 'account_missing') notFound();
  const t = await getTranslations('customers');
  return view.ok ? (
    <AccountScreen initial={view.data} companies={companyNames(access)} />
  ) : (
    <Page title={t('title')}>
      <FailureMessage failure={firstFailure(view)} />
    </Page>
  );
}
