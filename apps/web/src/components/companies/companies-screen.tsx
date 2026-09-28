'use client';

import type { EntityDto } from '@shakti/contracts';
import {
  Button,
  DataGrid,
  EmptyState,
  toast,
  useFocusTargets,
  type DataGridColumn,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { addressLine } from '../../screens/companies';

/** The edit dialog, fetched when an Executive first opens it rather than with the page. */
const EditCompanyDialog = dynamic(() =>
  import('./edit-company-dialog').then((m) => m.EditCompanyDialog),
);

/** Settings › Companies: the companies as a grid, and the edit dialog for an Executive. */
export function CompaniesScreen({ initial, canEdit }: { initial: EntityDto[]; canEdit: boolean }) {
  const t = useTranslations('companies');
  const common = useTranslations('common');
  const [rows, setRows] = useState(initial);
  const [editing, setEditing] = useState<EntityDto | undefined>();
  // Focus goes back to the row's Edit button, in the table or the phone card that shows.
  const editButtons = useFocusTargets<number>();

  const columns: DataGridColumn<EntityDto>[] = [
    { id: 'name', header: t('columns.name'), cell: (c) => c.legalName, primary: true },
    { id: 'brand', header: t('columns.brand'), cell: (c) => c.brandName },
    { id: 'state', header: t('columns.state'), cell: (c) => c.stateCode, numeric: true },
    { id: 'gstin', header: t('columns.gstin'), cell: (c) => c.gstin ?? common('notSet') },
    {
      id: 'address',
      header: t('columns.address'),
      cell: (c) => addressLine(c) ?? common('notSet'),
    },
    {
      id: 'upi',
      header: t('columns.upi'),
      cell: (c) =>
        c.upiId === null ? (
          <span className="whitespace-nowrap">{common('notSet')}</span>
        ) : (
          <span className="break-words">{c.upiId}</span>
        ),
    },
  ];
  if (canEdit) {
    columns.push({
      id: 'actions',
      header: t('columns.actions'),
      align: 'end',
      cell: (c) => (
        <Button
          ref={editButtons.ref(c.id)}
          variant="secondary"
          size="sm"
          aria-label={common('rowActions', { name: c.legalName })}
          onClick={() => {
            setEditing(c);
          }}
        >
          {t('edit')}
        </Button>
      ),
    });
  }

  return (
    <>
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={rows}
        rowKey={(c) => String(c.id)}
        empty={<EmptyState message={t('empty')} />}
      />
      {editing === undefined ? null : (
        <EditCompanyDialog
          company={editing}
          closeLabel={common('close')}
          returnFocusTo={() => [editButtons.get(editing.id)]}
          onSaved={(saved) => {
            setRows((all) => all.map((c) => (c.id === saved.id ? saved : c)));
            setEditing(undefined);
            toast.success(t('done', { name: saved.legalName }));
          }}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      )}
    </>
  );
}
