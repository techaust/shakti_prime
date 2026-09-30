import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { integrationHealth } from '../../../../actions/integrations';
import { IntegrationsScreen } from '../../../../components/integrations/integrations-screen';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { navRequires } from '../../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../../screens/access';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('admin-integrations'),
    (await getTranslations('integrations'))('title'),
  );
}

/**
 * Admin › Integration health (`admin.integrations.write`, docs/design/phase1.md §5.2): the
 * updates waiting to go out by kind, the held-back updates with Send again, the last sending
 * round and the delivery check. The database answers the outbox part through
 * `app.outbox_health()`, which checks the permission itself.
 */
export default async function IntegrationsPage() {
  const { access } = await screenAccess(navRequires('admin-integrations'));
  const t = await getTranslations('integrations');
  const health = await integrationHealth({ limit: 50 });
  return (
    <Page title={t('title')} description={t('intro')}>
      {health.ok ? (
        <IntegrationsScreen initial={health.data} companies={companyNames(access)} />
      ) : (
        <FailureMessage failure={firstFailure(health)} />
      )}
    </Page>
  );
}
