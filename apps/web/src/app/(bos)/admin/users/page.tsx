import { STAFF_ROLE_KEYS } from '@shakti/contracts';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listUsers } from '../../../../actions/admin';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { UsersScreen } from '../../../../components/users/users-screen';
import { companyNames, screenAccess } from '../../../../screens/access';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('users'))('title') };
}

/**
 * Admin › Team members: for a user administrator (`admin.users.write` for the whole group) only;
 * anyone else meets the not-found screen. Invitations and role changes cover the companies being
 * viewed, as the commands require.
 */
export default async function TeamMembersPage() {
  const { principal, access } = await screenAccess({ key: 'admin.users.write', scope: 'all' });
  const t = await getTranslations('users');
  const page = await listUsers({ limit: 50 });
  const viewed = access.entities
    .filter((e) => principal.entityIds.includes(e.entityId))
    .map((e) => ({ id: e.entityId, name: e.entityName }));
  return (
    <Page title={t('title')} description={t('intro')}>
      {page.ok ? (
        <UsersScreen
          initial={page.data}
          selfId={principal.id}
          companies={viewed}
          companyNames={companyNames(access)}
          roleKeys={[...STAFF_ROLE_KEYS]}
        />
      ) : (
        <FailureMessage failure={firstFailure(page)} />
      )}
    </Page>
  );
}
