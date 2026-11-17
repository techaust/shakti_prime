import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { readVoiceToday } from '../../../actions/voice';
import { FailureMessage } from '../../../components/screens/failure';
import { Page } from '../../../components/shell/page';
import { VoiceScreen } from '../../../components/voice/voice-screen';
import { liveKitConfig } from '../../../integrations/voice/livekit';
import { navRequires } from '../../../nav';
import { signingKeys } from '../../../realtime/keys';
import { bosIssuer } from '../../../realtime/token';
import { companyNames, screenAccess, screenTitle } from '../../../screens/access';
import { firstFailure } from '../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('voice'), (await getTranslations('voice'))('title'));
}

/** Whether a talk can start here: LiveKit, the signing keys and the issuer are all set. */
async function voiceSetUp(): Promise<boolean> {
  if (liveKitConfig() === undefined || bosIssuer() === undefined) return false;
  return (await signingKeys().catch(() => undefined)) !== undefined;
}

/**
 * Talk to Shakti (docs/03-roadmap-appendix/phase2.md §7.5, PRD AI-03): the recording question,
 * then a spoken talk in Ask or Teach, with its captions, cited records and drafts.
 */
export default async function VoicePage() {
  const { access, principal } = await screenAccess(navRequires('voice'));
  const t = await getTranslations('voice');
  const [today, setUp] = await Promise.all([readVoiceToday(), voiceSetUp()]);
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
