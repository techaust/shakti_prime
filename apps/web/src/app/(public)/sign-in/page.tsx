import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { currentSession } from '../../../auth/current-principal';
import { SIGN_IN_REASONS } from '../../../auth/sign-in-reasons';
import { SignInForm } from '../../../components/auth/sign-in-form';
import { Card, FormError } from '../../../components/form';
import { requestNonce } from '../../../nonce';
import { safeReturnPath } from '../../../session-gate';

export const dynamic = 'force-dynamic';

/** Each screen names itself, so a change of screen is announced (AUDIT M53). */
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('auth.signIn'))('title') };
}

/** Sign-in; a session that may not act stays here with the reason (a suspended or role-less user). */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; returnTo?: string }>;
}) {
  const { reason, returnTo } = await searchParams;
  // The BOS screen the person was on when their sign-in ended (WEB-7); never another site.
  const back = safeReturnPath(returnTo);
  const session = await currentSession();
  if (session && session.blocked === undefined) {
    redirect(session.principal ? back : '/two-factor');
  }
  const known = SIGN_IN_REASONS.find((r) => r === reason);
  const t = await getTranslations('auth.signIn');
  return (
    <Card title={t('title')} intro={t('intro')}>
      <FormError id="sign-in-reason" errorKey={known} />
      <SignInForm
        turnstileSiteKey={process.env.TURNSTILE_SITE_KEY ?? ''}
        nonce={await requestNonce()}
        returnTo={back === '/home' ? undefined : back}
      />
    </Card>
  );
}
