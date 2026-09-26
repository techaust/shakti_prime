import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { currentSession } from '../../../auth/current-principal';
import { EnrolForm, VerifyCodeForm } from '../../../components/auth/two-factor-forms';
import { Card } from '../../../components/form';

export const dynamic = 'force-dynamic';

/**
 * Two screens in one route: with a session whose role still needs an authenticator app, the
 * enrolment flow; without a session (the sign-in is waiting for its second factor), code entry.
 */
export default async function TwoFactorPage() {
  const session = await currentSession();
  const t = await getTranslations('auth.twoFactor');
  if (session?.blocked !== undefined) redirect('/sign-in?reason=no_access');
  if (session?.principal) redirect('/home');
  if (session) {
    return (
      <Card title={t('enrolTitle')} intro={t('enrolIntro')}>
        <EnrolForm />
      </Card>
    );
  }
  return (
    <Card title={t('verifyTitle')} intro={t('verifyIntro')}>
      <VerifyCodeForm allowBackupCode />
    </Card>
  );
}
