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
import {
  addressLine,
  COMPANY_FIELDS,
  companyChanges,
  type CompanyField,
} from '../../screens/companies';
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
      id: 'address',
      header: t('columns.address'),
      cell: (c) => addressLine(c) ?? common('notSet'),
    },
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
  const { fieldError, formFailure } = useFieldFailure(failure, COMPANY_FIELDS);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const typed = Object.fromEntries(COMPANY_FIELDS.map((f) => [f, formText(data, f)])) as Record<
      CompanyField,
      string
    >;
    const changes = companyChanges(company, typed);
    // Nothing changed: close the dialog without writing an empty change to the Activity log.
    if (Object.keys(changes).length === 0) {
      onCancel();
      return;
    }
    run({ entityId: company.id, ...changes }, onSaved);
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
      <Field
        id="company-gstin"
        label={t('gstin')}
        helper={t('gstinHelper')}
        error={fieldError('gstin')}
      >
        <Input
          name="gstin"
          defaultValue={company.gstin ?? ''}
          maxLength={20}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
      </Field>
      <Field
        id="company-state"
        label={t('stateCode')}
        helper={t('stateCodeHelper')}
        error={fieldError('stateCode')}
      >
        <Input
          name="stateCode"
          defaultValue={company.stateCode}
          required
          inputMode="numeric"
          maxLength={2}
          autoComplete="off"
        />
      </Field>
      <fieldset className="flex flex-col gap-4">
        <legend className="text-h3 mb-2">{t('addressHeading')}</legend>
        <Field
          id="company-address1"
          label={t('addressLine1')}
          helper={t('addressLine1Helper')}
          error={fieldError('addressLine1')}
        >
          <Input
            name="addressLine1"
            defaultValue={company.addressLine1 ?? ''}
            maxLength={120}
            autoComplete="address-line1"
          />
        </Field>
        <Field
          id="company-address2"
          label={t('addressLine2')}
          helper={t('addressLine2Helper')}
          error={fieldError('addressLine2')}
        >
          <Input
            name="addressLine2"
            defaultValue={company.addressLine2 ?? ''}
            maxLength={120}
            autoComplete="address-line2"
          />
        </Field>
        <Field id="company-city" label={t('city')} error={fieldError('city')}>
          <Input
            name="city"
            defaultValue={company.city ?? ''}
            maxLength={60}
            autoComplete="address-level2"
          />
        </Field>
        <Field id="company-pin" label={t('pin')} helper={t('pinHelper')} error={fieldError('pin')}>
          <Input
            name="pin"
            defaultValue={company.pin ?? ''}
            inputMode="numeric"
            maxLength={6}
            autoComplete="postal-code"
          />
        </Field>
      </fieldset>
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
