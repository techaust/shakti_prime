import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listRoles } from '../../../../actions/admin';
import { RolesScreen } from '../../../../components/roles/roles-screen';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { screenAccess, screenTitle } from '../../../../screens/access';
import { navRequires } from '../../../../nav';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('admin-roles'), (await getTranslations('adminRoles'))('title'));
}

/**
 * Admin › Roles (docs/design/phase1.md §6.2): the staff roles, for an Executive who manages roles
 * for the whole group (`admin.roles.write` at all companies) only; anyone else meets the
 * not-found screen. Each role opens its own page of permissions.
 */
export default async function RolesPage() {
  await screenAccess(navRequires('admin-roles'));
  const t = await getTranslations('adminRoles');
  const roles = await listRoles();
  return (
    <Page title={t('title')} description={t('intro')}>
      {roles.ok ? (
        <RolesScreen roles={roles.data.roles} />
      ) : (
        <FailureMessage failure={firstFailure(roles)} />
      )}
    </Page>
  );
}
