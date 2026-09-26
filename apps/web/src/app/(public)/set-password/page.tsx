import { getTranslations } from 'next-intl/server';
import { SetPasswordForm } from '../../../components/auth/set-password-form';
import { Card, FormError } from '../../../components/form';

export const dynamic = 'force-dynamic';

/** Landing page of the invite and reset links; the auth module redirects here with `?token=`. */
export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  const t = await getTranslations('auth.setPassword');
  return (
    <Card title={t('title')} intro={t('intro')}>
      {token === undefined || token === '' || error !== undefined ? (
        <FormError errorKey="link_expired" />
      ) : (
        <SetPasswordForm token={token} />
      )}
    </Card>
  );
}
