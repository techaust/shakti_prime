import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import {
  listCodedReferralPartners,
  listCommissionRules,
  listDispositions,
  listReferralPartners,
  listScoreRules,
  pipelineSettings,
} from '../../../../actions/crm-settings';
import { PipelineSettingsScreen } from '../../../../components/pipelines/pipeline-settings-screen';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { companyNames, screenAccess, screenTitle } from '../../../../screens/access';
import { navRequires } from '../../../../nav';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('settings-pipelines'),
    (await getTranslations('pipelineSettings'))('title'),
  );
}

/**
 * Settings › Pipelines (docs/design/phase1.md §6.6): an Executive shapes each pipeline and its
 * stages, the call outcomes, the lead score rules, the referral partners' codes and the
 * commission rules. A change to anything shared by all companies is made while viewing All
 * companies; the commands refuse it otherwise.
 */
export default async function PipelineSettingsPage() {
  const { access, principal } = await screenAccess(navRequires('settings-pipelines'));
  const t = await getTranslations('pipelineSettings');
  const shared = { entityId: null, segment: null };
  const [settings, outcomes, rules, partners, coded, commission] = await Promise.all([
    pipelineSettings(),
    listDispositions(shared),
    listScoreRules(shared),
    listReferralPartners({ cursor: null }),
    listCodedReferralPartners(),
    listCommissionRules(),
  ]);
  const names = companyNames(access);
  const companies = principal.entityIds.map((id) => ({ id, name: names[id] ?? String(id) }));
  return (
    <Page title={t('title')} description={t('intro')} width="detail">
      {settings.ok && outcomes.ok && rules.ok && partners.ok && coded.ok && commission.ok ? (
        <PipelineSettingsScreen
          pipelines={settings.data.pipelines}
          sources={settings.data.sources}
          companies={companies}
          sharedOutcomes={outcomes.data.dispositions}
          sharedRules={rules.data}
          partners={partners.data}
          codedPartners={coded.data}
          commissionRules={commission.data}
        />
      ) : (
        <FailureMessage
          failure={firstFailure(settings, outcomes, rules, partners, coded, commission)}
        />
      )}
    </Page>
  );
}
