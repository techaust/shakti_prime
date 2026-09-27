'use client';

import type { EntityDto } from '@shakti/contracts';
import {
  Button,
  DataGrid,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  toast,
  type DataGridColumn,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { updateEntity } from '../../actions/org';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';

/** Settings › Companies: the companies as a grid, and the edit dialog for an Executive. */
export function CompaniesScreen({ initial, canEdit }: { initial: EntityDto[]; canEdit: boolean }) {
  const t = useTranslations('companies');
  const common = useTranslations('common');
  const [rows, setRows] = useState(initial);
  const [editing, setEditing] = useState<EntityDto | undefined>();

  const columns: DataGridColumn<EntityDto>[] = [
    { id: 'name', header: t('columns.name'), cell: (c) => c.legalName, primary: true },
    { id: 'brand', header: t('columns.brand'), cell: (c) => c.brandName },
    { id: 'state', header: t('columns.state'), cell: (c) => c.stateCode, numeric: true },
    { id: 'gstin', header: t('columns.gstin'), cell: (c) => c.gstin ?? common('notSet') },
    {
      id: 'upi',
      header: t('columns.upi'),
      cell: (c) => <span className="break-all">{c.upiId ?? common('notSet')}</span>,
    },
  ];
  if (canEdit) {
    columns.push({
      id: 'actions',
      header: t('columns.actions'),
      align: 'end',
      cell: (c) => (
        <Button
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
      <Dialog
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
      >
        {editing === undefined ? null : (
          <DialogContent closeLabel={common('close')}>
            <EditCompanyForm
              company={editing}
              onSaved={(saved) => {
                setRows((all) => all.map((c) => (c.id === saved.id ? saved : c)));
                setEditing(undefined);
                toast.success(t('done', { name: saved.legalName }));
              }}
              onCancel={() => {
                setEditing(undefined);
              }}
            />
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

const FIELDS = ['brandName', 'upiId'] as const;

function EditCompanyForm({
  company,
  onSaved,
  onCancel,
}: {
  company: EntityDto;
  onSaved: (company: EntityDto) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('companies');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(updateEntity);
  const { fieldError, formFailure } = useFieldFailure(failure, FIELDS);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const brandName = formText(data, 'brandName');
    const upiId = formText(data, 'upiId');
    run({ entityId: company.id, brandName, upiId: upiId === '' ? null : upiId }, onSaved);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{t('editTitle', { name: company.legalName })}</DialogTitle>
        <DialogDescription>{t('editIntro')}</DialogDescription>
      </DialogHeader>
      <Field
        id="company-brand"
        label={t('brandName')}
        helper={t('brandNameHelper')}
        error={fieldError('brandName')}
      >
        <Input
          name="brandName"
          defaultValue={company.brandName}
          required
          minLength={2}
          maxLength={80}
          autoComplete="off"
        />
      </Field>
      <Field
        id="company-upi"
        label={t('upiId')}
        helper={t('upiHelper')}
        error={fieldError('upiId')}
      >
        <Input
          name="upiId"
          defaultValue={company.upiId ?? ''}
          maxLength={320}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <FailureMessage failure={formFailure} />
      <DialogFooter>
        <Button variant="secondary" onClick={onCancel}>
          {common('cancel')}
        </Button>
        <Button type="submit" pending={pending}>
          {t('submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}
