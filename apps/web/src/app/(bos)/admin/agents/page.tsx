import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { agentSettings } from '../../../../actions/agents';
import { AgentsScreen } from '../../../../components/agents/agents-screen';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { aiProvider } from '../../../../integrations/ai';
import { navRequires } from '../../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../../screens/access';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('admin-agents'), (await getTranslations('agents'))('admin.title'));
}

/**
 * Admin › Agents (docs/design/phase1.md §7.1): the kill switches for an Executive or a GM
 * (`agents.killswitch`), and for an Executive (`agents.autonomy.write`) each agent's autonomy, its
 * daily spending limit and the autonomy of each action type, at the company chosen at the top or
 * for the whole group.
 */
export default async function AgentsPage() {
  const { access, activeEntityId, can } = await screenAccess(navRequires('admin-agents'));
  const t = await getTranslations('agents');
  const settings = await agentSettings();
  const companyName =
    activeEntityId === undefined ? undefined : companyNames(access)[activeEntityId];
  return (
    <Page title={t('admin.title')} description={t('admin.intro')}>
      {aiProvider().claudeAvailable ? null : (
        <p role="note" className="border-border bg-surface-2 rounded-lg border p-4">
          {t('admin.notConnected')}
        </p>
      )}
      {settings.ok ? (
        <AgentsScreen
          initial={settings.data}
          canSetAutonomy={can('agents.autonomy.write', 'all')}
          companyName={companyName}
        />
      ) : (
        <FailureMessage failure={firstFailure(settings)} />
      )}
    </Page>
  );
}
