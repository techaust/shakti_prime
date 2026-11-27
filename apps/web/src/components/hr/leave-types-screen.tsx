'use client';

import type { LeaveTypeDto, LeaveTypeListDto } from '@shakti/contracts';
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
  Select,
  StatusBadge,
  toast,
  useFocusTargets,
  type DataGridColumn,
  type ReturnFocusTo,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useRef, useState, type SyntheticEvent } from 'react';
import { listLeaveTypes, setLeaveType } from '../../actions/hr';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand, useQuery } from '../screens/use-command';
import { companyName, type CompanyOption } from './hr-text';

const GROUP = 'group';
const DAYS = /^\d{1,3}(\.[05])?$/;

/**
 * HR › Leave types (docs/03-roadmap-appendix/phase5.md §5, PRD HR-02): the kinds of leave of each
 * company and of the whole group, with the days a year, whether unused days carry over and
 * whether the leave is paid. All of it is HR's to enter (HR-2); nothing is filled in.
 */
export function LeaveTypesScreen({
  initial,
  companies,
}: {
  initial: LeaveTypeListDto;
  companies: readonly CompanyOption[];
}) {
  const t = useTranslations('hr.leaveTypes');
  const hr = useTranslations('hr');
  const [types, setTypes] = useState(initial.leaveTypes);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<{ type: LeaveTypeDto | undefined } | undefined>();
  const { load, failure } = useQuery<LeaveTypeListDto>();
  const addButton = useRef<HTMLButtonElement>(null);
  const editButtons = useFocusTargets<string>();

  function reload(includeArchived = showArchived) {
    load(
      () => listLeaveTypes({ includeArchived }),
      (list) => {
        setTypes(list.leaveTypes);
      },
    );
  }

  const columns: DataGridColumn<LeaveTypeDto>[] = [
    { id: 'name', header: t('columns.name'), primary: true, cell: (lt) => lt.name },
    {
      id: 'company',
      header: t('columns.company'),
      cell: (lt) => (lt.entityId === null ? hr('wholeGroup') : companyName(companies, lt.entityId)),
    },
    {
      id: 'days',
      header: t('columns.daysPerYear'),
      numeric: true,
      cell: (lt) => hr('days', { count: lt.daysPerYear }),
    },
    {
      id: 'carries',
      header: t('columns.carriesForward'),
      cell: (lt) => (lt.carriesForward ? hr('yes') : hr('no')),
    },
    { id: 'paid', header: t('columns.paid'), cell: (lt) => (lt.paid ? hr('yes') : hr('no')) },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (lt) => (
        <StatusBadge tone={lt.archived ? 'neutral' : 'success'}>
          {lt.archived ? hr('archived') : hr('inUse')}
        </StatusBadge>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">{t('columns.actions')}</span>,
      align: 'end',
      cell: (lt) => (
        <Button
          ref={editButtons.ref(lt.id)}
          variant="secondary"
          size="sm"
          aria-label={t('editLabel', { name: lt.name })}
          onClick={() => {
            setEditing({ type: lt });
          }}
        >
          {t('edit')}
        </Button>
      ),
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex min-h-9 items-center gap-2">
          <input
            type="checkbox"
            className="accent-accent size-4"
            checked={showArchived}
            onChange={(e) => {
              setShowArchived(e.currentTarget.checked);
              reload(e.currentTarget.checked);
            }}
          />
          {t('showArchived')}
        </label>
        <Button
          ref={addButton}
          onClick={() => {
            setEditing({ type: undefined });
          }}
        >
          {t('add')}
        </Button>
      </div>
      <FailureMessage failure={failure} />
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={types}
        rowKey={(lt) => lt.id}
        empty={<EmptyState message={t('empty')} />}
      />
      {editing === undefined ? null : (
        <LeaveTypeForm
          type={editing.type}
          companies={companies}
          returnFocusTo={() => [
            editing.type === undefined ? addButton.current : editButtons.get(editing.type.id),
            addButton.current,
          ]}
          onClose={() => {
            setEditing(undefined);
          }}
          onSaved={() => {
            setEditing(undefined);
            reload();
          }}
        />
      )}
    </div>
  );
}

function LeaveTypeForm({
  type,
  companies,
  returnFocusTo,
  onClose,
  onSaved,
}: {
  type: LeaveTypeDto | undefined;
  companies: readonly CompanyOption[];
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('hr.leaveTypes.form');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(setLeaveType);
  const { fieldError, formFailure } = useFieldFailure(failure, ['name', 'daysPerYear']);
  const [problem, setProblem] = useState<'name' | 'days' | undefined>();

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const name = formText(data, 'name');
    const daysText = formText(data, 'daysPerYear');
    if (name.length === 0) {
      setProblem('name');
      return;
    }
    if (!DAYS.test(daysText) || Number(daysText) > 366) {
      setProblem('days');
      return;
    }
    setProblem(undefined);
    const company = type === undefined ? formText(data, 'company') : undefined;
    const entityId =
      type !== undefined ? type.entityId : company === GROUP ? null : Number(company);
    run(
      {
        ...(type === undefined ? {} : { id: type.id }),
        entityId,
        name,
        daysPerYear: Number(daysText),
        carriesForward: data.get('carriesForward') === 'on',
        paid: data.get('paid') === 'on',
        archived: type === undefined ? false : data.get('archived') === 'on',
      },
      () => {
        toast.success(t('saved'));
        onSaved();
      },
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent closeLabel={common('close')} returnFocusTo={returnFocusTo}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>
              {type === undefined ? t('addTitle') : t('editTitle', { name: type.name })}
            </DialogTitle>
            <DialogDescription>{t('intro')}</DialogDescription>
          </DialogHeader>
          {type === undefined ? (
            <Field id="leave-type-company" label={t('company')}>
              <Select name="company" defaultValue={String(companies[0]?.id ?? GROUP)}>
                {companies.map((c) => (
                  <option key={c.id ?? GROUP} value={c.id === null ? GROUP : String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field
            id="leave-type-name"
            label={t('name')}
            error={problem === 'name' ? t('nameMissing') : fieldError('name')}
          >
            <Input name="name" maxLength={120} defaultValue={type?.name ?? ''} />
          </Field>
          <Field
            id="leave-type-days"
            label={t('daysPerYear')}
            helper={t('daysHelper')}
            error={problem === 'days' ? t('daysInvalid') : fieldError('daysPerYear')}
          >
            <Input
              name="daysPerYear"
              inputMode="decimal"
              maxLength={5}
              defaultValue={type === undefined ? '' : String(type.daysPerYear)}
            />
          </Field>
          <label className="flex min-h-9 items-center gap-2">
            <input
              type="checkbox"
              name="carriesForward"
              className="accent-accent size-4"
              defaultChecked={type?.carriesForward ?? false}
            />
            {t('carriesForward')}
          </label>
          <label className="flex min-h-9 items-center gap-2">
            <input
              type="checkbox"
              name="paid"
              className="accent-accent size-4"
              defaultChecked={type?.paid ?? false}
            />
            {t('paid')}
          </label>
          {type === undefined ? null : (
            <label className="flex min-h-9 items-center gap-2">
              <input
                type="checkbox"
                name="archived"
                className="accent-accent size-4"
                defaultChecked={type.archived}
              />
              {t('archived')}
            </label>
          )}
          <FailureMessage failure={formFailure} />
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              {common('cancel')}
            </Button>
            <Button type="submit" pending={pending}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
