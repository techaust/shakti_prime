import { Button } from '@shakti/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { conciergeReport } from '../../../../../actions/concierge';
import { FailureMessage } from '../../../../../components/screens/failure';
import { Page } from '../../../../../components/shell/page';
import { navRequires } from '../../../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../../../screens/access';
import { ConciergeReportScreen } from '../../../../../screens/concierge/concierge-report';
import { firstFailure } from '../../../../../screens/result';
import { defaultShadowPeriod, SHADOW_PAGE_SIZE } from '../../../../../screens/shadow-report';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('admin-agents'),
    (await getTranslations('agents'))('conciergeReport.title'),
  );
}

/**
 * Admin › Agents › WhatsApp assistant report (docs/03-roadmap-appendix/phase2.md §7.2): the
 * WhatsApp Concierge's shadow report of one company, the one chosen at the top or else the first
 * the viewer works for, over the last 30 days in India until another company or period is chosen.
 * Opened, as Admin › Agents is, with either agent control (an Executive or a General Manager).
 */
export default async function ConciergeReportPage() {
  const { access, activeEntityId } = await screenAccess(navRequires('admin-agents'));
  const t = await getTranslations('agents');
  const companies = companyNames(access);
  const entityId = activeEntityId ?? access.entities[0]?.entityId;
  const period = defaultShadowPeriod(new Date());
  const report =
    entityId === undefined
      ? undefined
      : await conciergeReport({ entityId, ...period, limit: SHADOW_PAGE_SIZE });
  return (
    <Page
      title={t('conciergeReport.title')}
      description={t('conciergeReport.intro')}
      actions={
        <Button asChild variant="secondary">
          <Link href="/admin/agents">{t('shadow.back')}</Link>
        </Button>
      }
    >
      {report === undefined ? null : report.ok ? (
        <ConciergeReportScreen initial={report.data} companies={companies} />
      ) : (
        <FailureMessage failure={firstFailure(report)} />
      )}
    </Page>
  );
}
