'use client';

import type { EntityDto, FileDto } from '@shakti/contracts';
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
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { addressLine } from '../../screens/companies';
import type { BrandingPurpose, UploadLimitView } from './branding-dialog';

function currentFile(
  files: readonly FileDto[],
  entityId: number,
  purpose: BrandingPurpose,
): FileDto | undefined {
  return files.find((f) => f.entityId === entityId && f.purpose === purpose);
}

/** The edit dialog, fetched when an Executive first opens it rather than with the page. */
const EditCompanyDialog = dynamic(() =>
  import('./edit-company-dialog').then((m) => m.EditCompanyDialog),
);

/** The logo and letterhead uploads, fetched the same way. */
const BrandingDialog = dynamic(() => import('./branding-dialog').then((m) => m.BrandingDialog));

/** The bank account form and the proof page, fetched the same way. */
const BankDialog = dynamic(() => import('./bank-dialog').then((m) => m.BankDialog));
const ProofDialog = dynamic(() => import('./proof-dialog').then((m) => m.ProofDialog));

/**
 * Settings › Companies: the companies as a grid, and for an Executive the edit dialog, the logo and
 * letterhead uploads, the bank account and the proof page that prints them all.
 */
export function CompaniesScreen({
  initial,
  canEdit,
  branding = [],
  limits,
}: {
  initial: EntityDto[];
  canEdit: boolean;
  /** Each company's current logo and letterhead. */
  branding?: FileDto[];
  /** The upload limits of the two purposes; given when the caller may upload them. */
  limits?: Record<BrandingPurpose, UploadLimitView>;
}) {
  const t = useTranslations('companies');
  const common = useTranslations('common');
  const [rows, setRows] = useState(initial);
  const [editing, setEditing] = useState<EntityDto | undefined>();
  const [branded, setBranded] = useState<EntityDto | undefined>();
  const [banked, setBanked] = useState<EntityDto | undefined>();
  const [proofed, setProofed] = useState<EntityDto | undefined>();
  const router = useRouter();
  // Focus goes back to the row's Edit button, in the table or the phone card that shows.
  const editButtons = useFocusTargets<number>();
  const brandingButtons = useFocusTargets<number>();
  const bankButtons = useFocusTargets<number>();
  const proofButtons = useFocusTargets<number>();

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
    {
      id: 'bank',
      header: t('columns.bank'),
      cell: (c) => (c.bankDetailsSet ? t('bankRecorded') : common('notSet')),
    },
  ];
  if (canEdit) {
    columns.push({
      id: 'actions',
      header: t('columns.actions'),
      align: 'end',
      cell: (c) => (
        <div className="flex flex-wrap justify-end gap-2">
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
          {limits === undefined ? null : (
            <Button
              ref={brandingButtons.ref(c.id)}
              variant="secondary"
              size="sm"
              onClick={() => {
                setBranded(c);
              }}
            >
              {t('branding')}
            </Button>
          )}
          <Button
            ref={bankButtons.ref(c.id)}
            variant="secondary"
            size="sm"
            onClick={() => {
              setBanked(c);
            }}
          >
            {t('bank')}
          </Button>
          <Button
            ref={proofButtons.ref(c.id)}
            variant="secondary"
            size="sm"
            onClick={() => {
              setProofed(c);
            }}
          >
            {t('proof')}
          </Button>
        </div>
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
      {branded === undefined || limits === undefined ? null : (
        <BrandingDialog
          company={branded}
          current={{
            entity_logo: currentFile(branding, branded.id, 'entity_logo'),
            letterhead: currentFile(branding, branded.id, 'letterhead'),
          }}
          limits={limits}
          closeLabel={common('close')}
          returnFocusTo={() => [brandingButtons.get(branded.id)]}
          onUploaded={() => {
            router.refresh();
          }}
          onClose={() => {
            setBranded(undefined);
          }}
        />
      )}
      {banked === undefined ? null : (
        <BankDialog
          company={banked}
          closeLabel={common('close')}
          returnFocusTo={() => [bankButtons.get(banked.id)]}
          onSaved={(saved) => {
            setRows((all) => all.map((c) => (c.id === saved.id ? saved : c)));
            setBanked(undefined);
            toast.success(t('bankDone', { name: saved.legalName }));
          }}
          onClose={() => {
            setBanked(undefined);
          }}
        />
      )}
      {proofed === undefined ? null : (
        <ProofDialog
          company={proofed}
          closeLabel={common('close')}
          returnFocusTo={() => [proofButtons.get(proofed.id)]}
          onClose={() => {
            setProofed(undefined);
          }}
        />
      )}
    </>
  );
}
