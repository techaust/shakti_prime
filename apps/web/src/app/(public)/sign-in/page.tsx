import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { currentSession } from '../../../auth/current-principal';
import { SIGN_IN_REASONS } from '../../../auth/sign-in-reasons';
import { SignInForm } from '../../../components/auth/sign-in-form';
import { Card, FormError } from '../../../components/form';

export const dynamic = 'force-dynamic';

/** Sign-in; a session that may not act stays here with the reason (a suspended or role-less user). */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const session = await currentSession();
  if (session && session.blocked === undefined) {
    redirect(session.principal ? '/home' : '/two-factor');
  }
  const { reason } = await searchParams;
  const known = SIGN_IN_REASONS.find((r) => r === reason);
  const t = await getTranslations('auth.signIn');
  return (
    <Card title={t('title')} intro={t('intro')}>
      <FormError errorKey={known} />
      <SignInForm turnstileSiteKey={process.env.TURNSTILE_SITE_KEY ?? ''} />
    </Card>
  );
}
