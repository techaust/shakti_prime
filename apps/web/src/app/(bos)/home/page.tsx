import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Page } from '../../../components/shell/page';
import type { RoleNameKey } from '../../../i18n/types';
import { navRequires, visibleNav } from '../../../nav';
import { screenAccess, screenTitle } from '../../../screens/access';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('home'), (await getTranslations('auth.home'))('title'));
}

/**
 * The landing inside the shell: who you are, in which role and company, and a shortcut to every
 * screen your grants open (the same list as the sidebar). The theme and the password change live
 * on the profile screen, reached from the profile menu.
 */
export default async function HomePage() {
  const { principal, access } = await screenAccess(navRequires('home'));
  const t = await getTranslations('home');
  const auth = await getTranslations('auth.home');
  const nav = await getTranslations('nav');
  const roles = await getTranslations('roles');
  const active =
    principal.entityIds.length === 1
      ? access.entities.find((e) => e.entityId === principal.entityIds[0])
      : undefined;
  const shortcuts = visibleNav(principal.permissions).filter((item) => item.id !== 'home');
  return (
    <Page
      width="detail"
      title={t('greeting', { name: access.name })}
      description={
        <>
          {/* A signed-in person always holds a staff role; agents never sign in here. */}
          <span className="block">
            {auth('role', { role: roles(principal.roleKey as RoleNameKey) })}
          </span>
          <span className="block">
            {active === undefined
              ? t('allCompanies')
              : t('company', { company: active.entityName })}
          </span>
        </>
      }
    >
      <section aria-labelledby="home-shortcuts" className="flex flex-col gap-3">
        <h2 id="home-shortcuts" className="text-h3">
          {t('shortcutsTitle')}
        </h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shortcuts.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="bg-surface border-border hover:border-border-strong hover:bg-surface-2 flex h-full items-start gap-3 rounded-lg border p-4 transition-colors duration-(--motion-fast) ease-out"
                >
                  <span
                    aria-hidden
                    className="bg-accent-soft text-accent inline-flex size-8 shrink-0 items-center justify-center rounded-md"
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-[590]">{nav(item.label)}</span>
                    <span className="text-text-muted text-sm">
                      {t(`hint.${item.label as Exclude<typeof item.label, 'home'>}`)}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </Page>
  );
}
