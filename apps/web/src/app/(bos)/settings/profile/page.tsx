import { hasGrant, ThemeSchema } from '@shakti/contracts';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ownPresence } from '../../../../actions/handover';
import { ChangePasswordForm } from '../../../../components/auth/home-forms';
import { PresenceForm } from '../../../../components/profile/presence-form';
import { Page } from '../../../../components/shell/page';
import { ContrastSwitch, ThemeSwitch } from '../../../../components/theme';
import { companyNames, screenAccess, screenTitle } from '../../../../screens/access';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(undefined, (await getTranslations('profile'))('title'));
}

/**
 * The person's own settings, from the profile menu: the theme, the higher contrast (both kept on
 * the profile, so they follow the person to every device) and the password change.
 */
export default async function ProfilePage() {
  // Everyone who is signed in has a profile; it is reached from the profile menu, not the menu.
  const { principal, access } = await screenAccess();
  const t = await getTranslations('profile');
  const high = access.contrast === 'high';
  // Whoever works on leads is present or away in each company they work in (the handover reads it).
  const names = companyNames(access);
  const presence = hasGrant(principal.permissions, 'crm.lead.write', 'own')
    ? (
        await Promise.all(
          principal.entityIds.map(async (entityId) => ({
            entityId,
            company: names[entityId] ?? String(entityId),
            result: await ownPresence({ entityId }),
          })),
        )
      ).flatMap((r) => (r.result.ok ? [{ ...r, presence: r.result.data }] : []))
    : [];
  return (
    <Page width="form" title={t('title')} description={t('intro')}>
      <section className="bg-surface border-border flex flex-col gap-6 rounded-lg border p-6">
        <ThemeSwitch saved={ThemeSchema.catch('system').parse(access.theme)} />
        <ContrastSwitch saved={high} />
      </section>
      {presence.length === 0 ? null : (
        <section className="bg-surface border-border rounded-lg border p-6">
          <PresenceForm
            rows={presence.map(({ entityId, company, presence: state }) => ({
              entityId,
              company,
              presence: state,
            }))}
          />
        </section>
      )}
      <section
        id="change-password"
        className="bg-surface border-border scroll-mt-20 rounded-lg border p-6"
      >
        <ChangePasswordForm />
      </section>
    </Page>
  );
}
