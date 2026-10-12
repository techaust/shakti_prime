import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { currentSession, TWO_FACTOR_PENDING_COOKIE } from '../../../auth/current-principal';
import { EnrolForm, VerifyCodeForm } from '../../../components/auth/two-factor-forms';
import { Card } from '../../../components/form';
import { safeReturnPath } from '../../../session-gate';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.twoFactor');
  return { title: (await currentSession()) ? t('enrolTitle') : t('verifyTitle') };
}

/**
 * Two screens in one route: with a session whose role still needs an authenticator app, the
 * enrolment flow; while a sign-in waits for its second factor, code entry. Anyone else goes to
 * sign in, rather than meeting a code form for no sign-in (AUDIT L36).
 */
export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const session = await currentSession();
  const t = await getTranslations('auth.twoFactor');
  // The BOS screen the sign-in started from (WEB-7); never another site.
  const back = safeReturnPath((await searchParams).returnTo);
  if (session?.blocked !== undefined) redirect('/sign-in?reason=no_access');
  if (session?.principal) redirect(back);
  if (session) {
    return (
      <Card title={t('enrolTitle')} intro={t('enrolIntro')}>
        <EnrolForm />
      </Card>
    );
  }
  if ((await cookies()).get(TWO_FACTOR_PENDING_COOKIE) === undefined) redirect('/sign-in');
  return (
    <Card title={t('verifyTitle')} intro={t('verifyIntro')}>
      <VerifyCodeForm atSignIn returnTo={back === '/home' ? undefined : back} />
    </Card>
  );
}
