import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { SetPasswordForm } from '../../../components/auth/set-password-form';
import { Card, FormError } from '../../../components/form';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('auth.setPassword'))('title') };
}

const link =
  'text-accent-text inline-flex min-h-9 items-center self-start underline-offset-4 hover:underline max-md:min-h-11';

/** Landing page of the invite and reset links; the auth module redirects here with `?token=`. */
export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  const t = await getTranslations('auth.setPassword');
  const expired = token === undefined || token === '' || error !== undefined;
  return (
    <Card title={t('title')} intro={t('intro')}>
      {expired ? (
        // A dead link is not a dead end (AUDIT L36).
        <div className="flex flex-col gap-2">
          <FormError id="link-expired" errorKey="link_expired" />
          <Link href="/forgot-password" className={link}>
            {t('askNew')}
          </Link>
          <Link href="/sign-in" className={link}>
            {t('goSignIn')}
          </Link>
        </div>
      ) : (
        <SetPasswordForm token={token} />
      )}
    </Card>
  );
}
