import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { currentSession } from '../../../auth/current-principal';
import { SignInForm } from '../../../components/auth/sign-in-form';
import { Card } from '../../../components/form';

export const dynamic = 'force-dynamic';

export default async function SignInPage() {
  const session = await currentSession();
  if (session) redirect(session.principal ? '/home' : '/two-factor');
  const t = await getTranslations('auth.signIn');
  return (
    <Card title={t('title')} intro={t('intro')}>
      <SignInForm turnstileSiteKey={process.env.TURNSTILE_SITE_KEY ?? ''} />
    </Card>
  );
}
