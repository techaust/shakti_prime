import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Page } from '../../../../../components/shell/page';
import { TallyConnectorsScreen } from '../../../../../components/tally/tally-connectors-screen';
import { navRequires } from '../../../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../../../screens/access';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('admin-tally'), (await getTranslations('tallyConnectors'))('title'));
}

/**
 * Admin › Integrations › Tally (`admin.integrations.write`, docs/03-roadmap-appendix/phase5.md
 * §6.3): set up the connector on the office computer (its key shown once and kept only sealed),
 * link its Tally companies to the group's companies, make a new key, turn the old one off, and
 * turn a connector off.
 */
export default async function TallyConnectorsPage() {
  const { access, principal } = await screenAccess(navRequires('admin-tally'));
  const t = await getTranslations('tallyConnectors');
  const names = companyNames(access);
  const companies = principal.entityIds.map((id) => ({ id, name: names[id] ?? String(id) }));
  return (
    <Page title={t('title')} description={t('intro')} width="detail">
      <TallyConnectorsScreen companies={companies} />
    </Page>
  );
}
