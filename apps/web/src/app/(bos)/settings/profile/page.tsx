import { ThemeSchema } from '@shakti/contracts';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { cookies } from 'next/headers';
import { ChangePasswordForm } from '../../../../components/auth/home-forms';
import { Page } from '../../../../components/shell/page';
import { ContrastSwitch, ThemeSwitch } from '../../../../components/theme';
import { screenAccess, screenTitle } from '../../../../screens/access';
import { CONTRAST_COOKIE, isHighContrast } from '../../../../theme';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(undefined, (await getTranslations('profile'))('title'));
}

/**
 * The person's own settings, from the profile menu: the theme, the higher contrast for this
 * device and the password change.
 */
export default async function ProfilePage() {
  // Everyone who is signed in has a profile; it is reached from the profile menu, not the menu.
  const { access } = await screenAccess();
  const t = await getTranslations('profile');
  const high = isHighContrast((await cookies()).get(CONTRAST_COOKIE)?.value);
  return (
    <Page width="form" title={t('title')} description={t('intro')}>
      <section className="bg-surface border-border flex flex-col gap-6 rounded-lg border p-6">
        <ThemeSwitch saved={ThemeSchema.catch('system').parse(access.theme)} />
        <ContrastSwitch saved={high} />
      </section>
      <section
        id="change-password"
        className="bg-surface border-border scroll-mt-20 rounded-lg border p-6"
      >
        <ChangePasswordForm />
      </section>
    </Page>
  );
}
