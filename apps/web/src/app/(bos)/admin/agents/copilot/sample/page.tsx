import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import {
  REVIEW_TITLE,
  ShadowReviewPage,
} from '../../../../../../components/agents/shadow-review-page';
import { navRequires } from '../../../../../../nav';
import { screenTitle } from '../../../../../../screens/access';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('admin-agents'),
    (await getTranslations('agents.shadowPack'))(REVIEW_TITLE.copilot),
  );
}

/** The suggestions to review of the Co-pilot (G2 shadow review pack). */
export default function CopilotReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <ShadowReviewPage agent="copilot" searchParams={searchParams} />;
}
