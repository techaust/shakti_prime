import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { currentSession } from '../../../auth/current-principal';
import {
  ChangePasswordForm,
  EntitySwitcher,
  SignOutButton,
} from '../../../components/auth/home-forms';

export const dynamic = 'force-dynamic';

/** Signed-in landing until the app shell arrives in week 4: who you are, where you are, sign out. */
export default async function HomePage() {
  const session = await currentSession();
  if (!session) redirect('/sign-in');
  if (!session.principal) redirect('/two-factor');
  const principal = session.principal;
  const t = await getTranslations('auth.home');
  const roles = await getTranslations('roles');
  const active = principal.entityIds.length === 1 ? principal.entityIds[0] : undefined;
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-8 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-[length:var(--font-h1-size)] leading-[var(--font-h1-line)] font-semibold">
          {t('title')}
        </h1>
        <p>{t('signedInAs', { name: session.access.name })}</p>
        <p className="text-text-muted">{t('role', { role: roles(principal.roleKey) })}</p>
      </div>
      <EntitySwitcher
        entities={session.access.entities.map((e) => ({
          entityId: e.entityId,
          label: e.entityName,
        }))}
        active={active}
      />
      <ChangePasswordForm />
      <SignOutButton />
    </main>
  );
}
