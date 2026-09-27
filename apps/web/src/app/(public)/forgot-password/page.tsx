import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ForgotPasswordForm } from '../../../components/auth/forgot-password-form';
import { Card } from '../../../components/form';
import { requestNonce } from '../../../nonce';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('auth.forgotPassword'))('title') };
}

/** A forgotten password, or an invitation link that ran out: a new link by email (AUDIT M26). */
export default async function ForgotPasswordPage() {
  const t = await getTranslations('auth.forgotPassword');
  return (
    <Card title={t('title')} intro={t('intro')}>
      <ForgotPasswordForm
        turnstileSiteKey={process.env.TURNSTILE_SITE_KEY ?? ''}
        nonce={await requestNonce()}
      />
    </Card>
  );
}
