'use client';

import type { ShiftDto, ShiftListDto } from '@shakti/contracts';
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
import { listShifts, setShift } from '../../actions/hr';
import { ISO_WEEKDAYS } from '../../screens/contract-values';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand, useQuery } from '../screens/use-command';
import { companyName, useDayName, useWeekdayText, type CompanyOption } from './hr-text';

/** The working day a new shift starts from: HR-1's answer (`WORKSHOP_DEFAULTS.hr`). */
export interface ShiftStart {
  startTime: string;
  endTime: string;
  lunchMinutes: number;
  graceMinutes: number;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const GROUP = 'group';

/**
 * HR › Shifts (docs/03-roadmap-appendix/phase5.md §5, PRD HR-01): the working patterns of each
 * company and of the whole group. HR adds, changes and archives them; a new one starts from the
 * working day HR-1 gave.
 */
export function ShiftsScreen({
  initial,
  companies,
  start,
}: {
  initial: ShiftListDto;
  /** Where a new shift may belong: the whole group (`id` null) first when the request covers it. */
  companies: readonly CompanyOption[];
  start: ShiftStart;
}) {
  const t = useTranslations('hr.shifts');
  const hr = useTranslations('hr');
  const weekdays = useWeekdayText();
  const [shifts, setShifts] = useState(initial.shifts);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<{ shift: ShiftDto | undefined } | undefined>();
  const { load, failure } = useQuery<ShiftListDto>();
  const addButton = useRef<HTMLButtonElement>(null);
  const editButtons = useFocusTargets<string>();

  function reload(includeArchived = showArchived) {
    load(
      () => listShifts({ includeArchived }),
      (list) => {
        setShifts(list.shifts);
      },
    );
  }

  const columns: DataGridColumn<ShiftDto>[] = [
    { id: 'name', header: t('columns.name'), primary: true, cell: (s) => s.name },
    {
      id: 'company',
      header: t('columns.company'),
      cell: (s) => (s.entityId === null ? hr('wholeGroup') : companyName(companies, s.entityId)),
    },
    {
      id: 'hours',
      header: t('columns.hours'),
      cell: (s) => t('hours', { start: s.startTime, end: s.endTime }),
    },
    {
      id: 'lunch',
      header: t('columns.lunch'),
      numeric: true,
      cell: (s) => hr('minutes', { count: s.lunchMinutes }),
    },
    {
      id: 'grace',
      header: t('columns.grace'),
      numeric: true,
      cell: (s) => hr('minutes', { count: s.graceMinutes }),
    },
    { id: 'off', header: t('columns.daysOff'), cell: (s) => weekdays(s.weeklyOffDays) },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (s) => (
        <StatusBadge tone={s.archived ? 'neutral' : 'success'}>
          {s.archived ? hr('archived') : hr('inUse')}
        </StatusBadge>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">{t('columns.actions')}</span>,
      align: 'end',
      cell: (s) => (
        <Button
          ref={editButtons.ref(s.id)}
          variant="secondary"
          size="sm"
          aria-label={t('editLabel', { name: s.name })}
          onClick={() => {
            setEditing({ shift: s });
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
            setEditing({ shift: undefined });
          }}
        >
          {t('add')}
        </Button>
      </div>
      <FailureMessage failure={failure} />
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={shifts}
        rowKey={(s) => s.id}
        empty={<EmptyState message={t('empty')} />}
      />
      {editing === undefined ? null : (
        <ShiftForm
          shift={editing.shift}
          companies={companies}
          start={start}
          returnFocusTo={() => [
            editing.shift === undefined ? addButton.current : editButtons.get(editing.shift.id),
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

function ShiftForm({
  shift,
  companies,
  start,
  returnFocusTo,
  onClose,
  onSaved,
}: {
  shift: ShiftDto | undefined;
  companies: readonly CompanyOption[];
  start: ShiftStart;
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('hr.shifts.form');
  const dayName = useDayName();
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(setShift);
  const { fieldError, formFailure } = useFieldFailure(failure, [
    'name',
    'startTime',
    'endTime',
    'lunchMinutes',
    'graceMinutes',
    'weeklyOffDays',
  ]);
  const [problem, setProblem] = useState<'name' | 'times' | 'minutes' | 'days' | undefined>();

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const name = formText(data, 'name');
    const startTime = formText(data, 'startTime');
    const endTime = formText(data, 'endTime');
    const lunchMinutes = Number(formText(data, 'lunchMinutes'));
    const graceMinutes = Number(formText(data, 'graceMinutes'));
    const weeklyOffDays = data.getAll('weeklyOffDays').map(Number);
    if (name.length === 0) {
      setProblem('name');
      return;
    }
    if (!TIME.test(startTime) || !TIME.test(endTime) || startTime === endTime) {
      setProblem('times');
      return;
    }
    if (
      !Number.isInteger(lunchMinutes) ||
      lunchMinutes < 0 ||
      lunchMinutes > 240 ||
      !Number.isInteger(graceMinutes) ||
      graceMinutes < 0 ||
      graceMinutes > 120
    ) {
      setProblem('minutes');
      return;
    }
    if (weeklyOffDays.length > 6) {
      setProblem('days');
      return;
    }
    setProblem(undefined);
    const company = shift === undefined ? formText(data, 'company') : undefined;
    const entityId =
      shift !== undefined ? shift.entityId : company === GROUP ? null : Number(company);
    run(
      {
        ...(shift === undefined ? {} : { id: shift.id }),
        entityId,
        name,
        startTime,
        endTime,
        lunchMinutes,
        graceMinutes,
        weeklyOffDays,
        archived: shift === undefined ? false : data.get('archived') === 'on',
      },
      () => {
        toast.success(t('saved'));
        onSaved();
      },
    );
  }

  const offDays = shift?.weeklyOffDays ?? [];
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
              {shift === undefined ? t('addTitle') : t('editTitle', { name: shift.name })}
            </DialogTitle>
            <DialogDescription>{t('intro')}</DialogDescription>
          </DialogHeader>
          {shift === undefined ? (
            <Field id="shift-company" label={t('company')}>
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
            id="shift-name"
            label={t('name')}
            error={problem === 'name' ? t('nameMissing') : fieldError('name')}
          >
            <Input name="name" maxLength={120} defaultValue={shift?.name ?? ''} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="shift-start"
              label={t('startTime')}
              error={problem === 'times' ? t('timesInvalid') : fieldError('startTime')}
            >
              <Input
                name="startTime"
                type="time"
                defaultValue={shift?.startTime ?? start.startTime}
              />
            </Field>
            <Field id="shift-end" label={t('endTime')} error={fieldError('endTime')}>
              <Input name="endTime" type="time" defaultValue={shift?.endTime ?? start.endTime} />
            </Field>
            <Field
              id="shift-lunch"
              label={t('lunchMinutes')}
              error={problem === 'minutes' ? t('minutesInvalid') : fieldError('lunchMinutes')}
            >
              <Input
                name="lunchMinutes"
                inputMode="numeric"
                maxLength={3}
                defaultValue={String(shift?.lunchMinutes ?? start.lunchMinutes)}
              />
            </Field>
            <Field
              id="shift-grace"
              label={t('graceMinutes')}
              helper={t('graceHelper')}
              error={fieldError('graceMinutes')}
            >
              <Input
                name="graceMinutes"
                inputMode="numeric"
                maxLength={3}
                defaultValue={String(shift?.graceMinutes ?? start.graceMinutes)}
              />
            </Field>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-medium">{t('daysOff')}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {ISO_WEEKDAYS.map((d) => (
                <label key={d} className="flex min-h-9 items-center gap-2">
                  <input
                    type="checkbox"
                    name="weeklyOffDays"
                    value={String(d)}
                    className="accent-accent size-4"
                    defaultChecked={offDays.includes(d)}
                  />
                  {dayName(d)}
                </label>
              ))}
            </div>
            {problem === 'days' ? <p className="text-danger text-sm">{t('daysInvalid')}</p> : null}
          </fieldset>
          {shift === undefined ? null : (
            <label className="flex min-h-9 items-center gap-2">
              <input
                type="checkbox"
                name="archived"
                className="accent-accent size-4"
                defaultChecked={shift.archived}
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
