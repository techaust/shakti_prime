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
    (await getTranslations('agents.shadowPack'))(REVIEW_TITLE.concierge),
  );
}

/** The suggestions to review of the WhatsApp assistant (G2 shadow review pack). */
export default function ConciergeReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <ShadowReviewPage agent="concierge" searchParams={searchParams} />;
}
