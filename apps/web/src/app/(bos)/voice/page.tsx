import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { readVoiceToday } from '../../../actions/voice';
import { FailureMessage } from '../../../components/screens/failure';
import { Page } from '../../../components/shell/page';
import { VoiceScreen } from '../../../components/voice/voice-screen';
import { liveKitConfig } from '../../../integrations/voice/livekit';
import { navRequires } from '../../../nav';
import { bosIssuer } from '../../../realtime/token';
import { companyNames, screenAccess, screenTitle } from '../../../screens/access';
import { firstFailure } from '../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('voice'), (await getTranslations('voice'))('title'));
}

/**
 * Whether a talk can start here: LiveKit and the issuer are set (every Phase 2 integration is off
 * on production until the final phase). The start route checks the signing keys as well.
 */
function voiceSetUp(): boolean {
  return liveKitConfig() !== undefined && bosIssuer() !== undefined;
}

/**
 * Talk to Shakti (docs/03-roadmap-appendix/phase2.md §7.5, PRD AI-03): the recording question,
 * then a spoken talk in Ask or Teach, with its captions, cited records and drafts.
 */
export default async function VoicePage() {
  const { access, principal } = await screenAccess(navRequires('voice'));
  const t = await getTranslations('voice');
  const today = await readVoiceToday();
  const setUp = voiceSetUp();
  const names = companyNames(access);
  const companies = principal.entityIds.map((id) => ({ id, name: names[id] ?? String(id) }));
  return (
    <Page title={t('title')} description={t('intro')}>
      {today.ok ? (
        <VoiceScreen
          setUp={setUp}
          minutesLeft={today.data.minutesLeft}
          sessionMaxMinutes={today.data.sessionMaxMinutes}
          companies={companies}
        />
      ) : (
        <FailureMessage failure={firstFailure(today)} />
      )}
    </Page>
  );
}
