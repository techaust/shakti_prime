import { ThemeSchema } from '@shakti/contracts';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ChangePasswordForm } from '../../../../components/auth/home-forms';
import { Page } from '../../../../components/shell/page';
import { ThemeSwitch } from '../../../../components/theme';
import { screenAccess } from '../../../../screens/access';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('profile'))('title') };
}

/** The person's own settings, from the profile menu: the theme and the password change. */
export default async function ProfilePage() {
  // Everyone who is signed in has a profile; it is reached from the profile menu, not the menu.
  const { access } = await screenAccess();
  const t = await getTranslations('profile');
  return (
    <Page width="form" title={t('title')} description={t('intro')}>
      <section className="bg-surface border-border rounded-lg border p-6">
        <ThemeSwitch saved={ThemeSchema.catch('system').parse(access.theme)} />
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
