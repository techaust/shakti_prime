'use client';

import type { RoleSummaryDto } from '@shakti/contracts';
import { Button, DataGrid, EmptyState, StatusBadge, type DataGridColumn } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import type { Route } from 'next';
import Link from 'next/link';
import { formatDate } from '../../screens/format';

/** Admin › Roles: the staff roles as a grid, each opening its own page of permissions. */
export function RolesScreen({ roles }: { roles: RoleSummaryDto[] }) {
  const t = useTranslations('adminRoles');
  const names = useTranslations('roles');

  const columns: DataGridColumn<RoleSummaryDto>[] = [
    { id: 'role', header: t('columns.role'), cell: (r) => names(r.key), primary: true },
    {
      id: 'permissions',
      header: t('columns.permissions'),
      cell: (r) => t('permissionCount', { count: r.grantCount }),
    },
    {
      id: 'people',
      header: t('columns.people'),
      cell: (r) => t('peopleCount', { count: r.holderCount }),
    },
    {
      id: 'changed',
      header: t('columns.changed'),
      cell: (r) =>
        r.customisedAt === null ? (
          <StatusBadge tone="neutral">{t('standard')}</StatusBadge>
        ) : (
          <StatusBadge tone="info">
            {t('customised', { date: formatDate(r.customisedAt) })}
          </StatusBadge>
        ),
    },
    {
      id: 'actions',
      header: t('columns.actions'),
      align: 'end',
      cell: (r) => (
        <Button variant="secondary" size="sm" asChild>
          <Link
            href={`/admin/roles/${r.key}` as Route}
            aria-label={t('editLabel', { role: names(r.key) })}
          >
            {t('edit')}
          </Link>
        </Button>
      ),
    },
  ];

  return (
    <DataGrid
      caption={t('caption')}
      columns={columns}
      rows={roles}
      rowKey={(r) => r.key}
      empty={<EmptyState message={t('people', { count: 0 })} />}
    />
  );
}
