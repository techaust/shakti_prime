import { Button } from '@shakti/ui';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { conciergeSample } from '../../actions/concierge';
import { copilotSample } from '../../actions/copilot';
import { navRequires } from '../../nav';
import { companyNames, screenAccess } from '../../screens/access';
import { firstFailure } from '../../screens/result';
import { sampleQuery, type SampleAgent } from '../../screens/shadow-report';
import { FailureMessage } from '../screens/failure';
import { Page } from '../shell/page';
import { PrintButton } from './print-button';
import { PrintSheet } from './print-sheet';
import { ShadowReviewSheet } from './shadow-review-sheet';

/** Each agent's page title. */
export const REVIEW_TITLE = {
  concierge: 'review.conciergeTitle',
  copilot: 'review.copilotTitle',
} as const satisfies Record<SampleAgent, string>;

/**
 * Admin › Agents › a report › Suggestions to review (the G2 shadow review pack,
 * docs/03-roadmap-appendix/phase2.md §8.1): the company and period the address names (the report's
 * own, from its link), else the viewer's company and the last 30 days. Opened, as Admin › Agents
 * is, with either agent control; the read checks it again. Printed, it is the sheet alone, light.
 */
export async function ShadowReviewPage({
  agent,
  searchParams,
}: {
  agent: SampleAgent;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { access, activeEntityId } = await screenAccess(navRequires('admin-agents'));
  const t = await getTranslations('agents.shadowPack');
  const companies = companyNames(access);
  const query = sampleQuery(
    await searchParams,
    access.entities.map((e) => e.entityId),
    activeEntityId ?? access.entities[0]?.entityId,
    new Date(),
  );
  const { entityId } = query;
  const read = agent === 'concierge' ? conciergeSample : copilotSample;
  const sample =
    entityId === undefined ? undefined : await read({ entityId, from: query.from, to: query.to });
  return (
    <PrintSheet>
      <Page
        title={t(REVIEW_TITLE[agent])}
        description={t('review.intro')}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <PrintButton label={t('review.print')} />
            <Button asChild variant="secondary">
              <Link href={`/admin/agents/${agent}`}>{t('review.back')}</Link>
            </Button>
          </div>
        }
      >
        {sample === undefined || entityId === undefined ? null : sample.ok ? (
          <ShadowReviewSheet sample={sample.data} companyName={companies[entityId] ?? ''} />
        ) : (
          <FailureMessage failure={firstFailure(sample)} />
        )}
      </Page>
    </PrintSheet>
  );
}
