import { Button } from '@shakti/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { shadowReport } from '../../../../../actions/agents';
import { ShadowReportScreen } from '../../../../../components/agents/shadow-report-screen';
import { FailureMessage } from '../../../../../components/screens/failure';
import { Page } from '../../../../../components/shell/page';
import { navRequires } from '../../../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../../../screens/access';
import { defaultShadowPeriod, SHADOW_PAGE_SIZE } from '../../../../../screens/shadow-report';
import { firstFailure } from '../../../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('admin-agents'), (await getTranslations('agents'))('shadow.title'));
}

/**
 * Admin › Agents › Triage proposals (docs/03-roadmap-appendix/phase1.md §9, A1): the shadow report
 * of one company, the one chosen at the top or else the first the viewer works for, over the last
 * 30 days in India until another company or period is chosen. Opened, as Admin › Agents is, with
 * either agent control (an Executive or a General Manager).
 */
export default async function ShadowReportPage() {
  const { access, activeEntityId } = await screenAccess(navRequires('admin-agents'));
  const t = await getTranslations('agents');
  const companies = companyNames(access);
  const entityId = activeEntityId ?? access.entities[0]?.entityId;
  const period = defaultShadowPeriod(new Date());
  const report =
    entityId === undefined
      ? undefined
      : await shadowReport({ entityId, ...period, limit: SHADOW_PAGE_SIZE });
  return (
    <Page
      title={t('shadow.title')}
      description={t('shadow.intro')}
      actions={
        <Button asChild variant="secondary">
          <Link href="/admin/agents">{t('shadow.back')}</Link>
        </Button>
      }
    >
      {report === undefined ? null : report.ok ? (
        <ShadowReportScreen initial={report.data} companies={companies} />
      ) : (
        <FailureMessage failure={firstFailure(report)} />
      )}
    </Page>
  );
}
