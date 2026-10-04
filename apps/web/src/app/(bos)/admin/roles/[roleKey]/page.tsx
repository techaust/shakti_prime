import { STAFF_ROLE_KEYS, type StaffRoleKey } from '@shakti/contracts';
import { Button } from '@shakti/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getRoleGrants } from '../../../../../actions/admin';
import { RoleEditor } from '../../../../../components/roles/role-editor';
import { FailureMessage } from '../../../../../components/screens/failure';
import { Page } from '../../../../../components/shell/page';
import { screenAccess, screenTitle } from '../../../../../screens/access';
import { navRequires } from '../../../../../nav';
import { firstFailure } from '../../../../../screens/result';

export const dynamic = 'force-dynamic';

const isStaffRole = (key: string): key is StaffRoleKey =>
  (STAFF_ROLE_KEYS as readonly string[]).includes(key);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ roleKey: string }>;
}): Promise<Metadata> {
  const { roleKey } = await params;
  const roles = await getTranslations('roles');
  const t = await getTranslations('adminRoles');
  return screenTitle(
    navRequires('admin-roles'),
    isStaffRole(roleKey) ? t('roleTitle', { role: roles(roleKey) }) : t('title'),
  );
}

/**
 * One staff role's permissions (docs/design/phase1.md §6.2): the catalogue grouped by module, a
 * scope for each, and the save that signs the role's holders out. An agent role or any other key
 * meets the not-found screen: agents keep their fixed sets (docs/SECURITY.md §3.3).
 */
export default async function RolePage({ params }: { params: Promise<{ roleKey: string }> }) {
  const { access } = await screenAccess(navRequires('admin-roles'));
  const { roleKey } = await params;
  if (!isStaffRole(roleKey)) notFound();
  const t = await getTranslations('adminRoles');
  const roles = await getTranslations('roles');
  const back = (
    <Button variant="secondary" asChild>
      <Link href="/admin/roles">{t('back')}</Link>
    </Button>
  );
  const page = await getRoleGrants({ roleKey });
  const holdsRole = access.entities.some((e) => e.roleKey === roleKey);
  return (
    <Page
      title={t('roleTitle', { role: roles(roleKey) })}
      description={t('roleIntro')}
      actions={back}
      width="detail"
    >
      {page.ok ? (
        <RoleEditor initial={page.data} holdsRole={holdsRole} />
      ) : (
        <FailureMessage failure={firstFailure(page)} />
      )}
    </Page>
  );
}
