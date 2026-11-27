'use client';

import type { HolidayDto, HolidayListDto } from '@shakti/contracts';
import {
  Button,
  DataGrid,
  DateInput,
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
  toast,
  useFocusTargets,
  type DataGridColumn,
  type ReturnFocusTo,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useRef, useState, type SyntheticEvent } from 'react';
import { listHolidays, setHoliday } from '../../actions/hr';
import { formatDate } from '../../screens/format';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand, useQuery } from '../screens/use-command';
import { companyName, useDayName, type CompanyOption } from './hr-text';
import { isoDayOf } from './iso-day';

const GROUP = 'group';

/**
 * HR › Holidays (docs/03-roadmap-appendix/phase5.md §5, PRD HR-02): one year's holidays of each
 * company and of the whole group, the days a leave request leaves out. HR names a holiday,
 * renames it or takes the day off the list. None is filled in until HR-2.
 */
export function HolidaysScreen({
  initial,
  year,
  years,
  companies,
}: {
  initial: HolidayListDto;
  year: number;
  years: readonly number[];
  companies: readonly CompanyOption[];
}) {
  const t = useTranslations('hr.holidays');
  const hr = useTranslations('hr');
  const dayName = useDayName();
  const [shown, setShown] = useState(year);
  const [holidays, setHolidays] = useState(initial.holidays);
  const [editing, setEditing] = useState<{ holiday: HolidayDto | undefined } | undefined>();
  const { load, failure } = useQuery<HolidayListDto>();
  const remove = useCommand(setHoliday);
  const addButton = useRef<HTMLButtonElement>(null);
  const rowButtons = useFocusTargets<string>();

  function reload(y = shown) {
    load(
      () => listHolidays({ year: y }),
      (list) => {
        setHolidays(list.holidays);
      },
    );
  }

  const where = (h: HolidayDto) =>
    h.entityId === null ? hr('wholeGroup') : companyName(companies, h.entityId);

  const columns: DataGridColumn<HolidayDto>[] = [
    {
      id: 'date',
      header: t('columns.date'),
      primary: true,
      cell: (h) => t('dateLine', { date: formatDate(h.date), day: dayName(isoDayOf(h.date)) }),
    },
    { id: 'name', header: t('columns.name'), cell: (h) => h.name ?? '' },
    { id: 'company', header: t('columns.company'), cell: where },
    {
      id: 'actions',
      header: <span className="sr-only">{t('columns.actions')}</span>,
      align: 'end',
      cell: (h) => (
        <span className="flex justify-end gap-2">
          <Button
            ref={rowButtons.ref(h.id ?? h.date)}
            variant="secondary"
            size="sm"
            aria-label={t('renameLabel', { date: formatDate(h.date) })}
            onClick={() => {
              setEditing({ holiday: h });
            }}
          >
            {t('rename')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            pending={remove.pending}
            aria-label={t('removeLabel', { date: formatDate(h.date) })}
            onClick={() => {
              remove.run({ entityId: h.entityId, date: h.date, name: null }, () => {
                toast.success(t('removed'));
                reload();
              });
            }}
          >
            {t('remove')}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <Field id="holidays-year" label={t('year')} className="md:w-48">
          <Select
            value={String(shown)}
            onChange={(e) => {
              const next = Number(e.currentTarget.value);
              setShown(next);
              reload(next);
            }}
          >
            {years.map((y) => (
              <option key={y} value={String(y)}>
                {String(y)}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          ref={addButton}
          onClick={() => {
            setEditing({ holiday: undefined });
          }}
        >
          {t('add')}
        </Button>
      </div>
      <FailureMessage failure={failure ?? remove.failure} />
      <DataGrid
        caption={t('caption', { year: String(shown) })}
        columns={columns}
        rows={holidays}
        rowKey={(h) => h.id ?? `${String(h.entityId)}-${h.date}`}
        empty={<EmptyState message={t('empty')} />}
      />
      {editing === undefined ? null : (
        <HolidayForm
          holiday={editing.holiday}
          companies={companies}
          returnFocusTo={() => [
            editing.holiday === undefined
              ? addButton.current
              : rowButtons.get(editing.holiday.id ?? editing.holiday.date),
            addButton.current,
          ]}
          onClose={() => {
            setEditing(undefined);
          }}
          onSaved={(saved) => {
            setEditing(undefined);
            const savedYear = Number(saved.date.slice(0, 4));
            setShown(savedYear);
            reload(savedYear);
          }}
        />
      )}
    </div>
  );
}

function HolidayForm({
  holiday,
  companies,
  returnFocusTo,
  onClose,
  onSaved,
}: {
  holiday: HolidayDto | undefined;
  companies: readonly CompanyOption[];
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onSaved: (holiday: HolidayDto) => void;
}) {
  const t = useTranslations('hr.holidays.form');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(setHoliday);
  const { fieldError, formFailure } = useFieldFailure(failure, ['date', 'name']);
  const [problem, setProblem] = useState<'date' | 'name' | undefined>();

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const date = holiday?.date ?? formText(data, 'date');
    const name = formText(data, 'name');
    if (date === '') {
      setProblem('date');
      return;
    }
    if (name.length === 0) {
      setProblem('name');
      return;
    }
    setProblem(undefined);
    const company = holiday === undefined ? formText(data, 'company') : undefined;
    const entityId =
      holiday !== undefined ? holiday.entityId : company === GROUP ? null : Number(company);
    run({ entityId, date, name }, (saved) => {
      toast.success(t('saved'));
      onSaved(saved);
    });
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
              {holiday === undefined
                ? t('addTitle')
                : t('renameTitle', { date: formatDate(holiday.date) })}
            </DialogTitle>
            <DialogDescription>{t('intro')}</DialogDescription>
          </DialogHeader>
          {holiday === undefined ? (
            <>
              <Field id="holiday-company" label={t('company')}>
                <Select name="company" defaultValue={String(companies[0]?.id ?? GROUP)}>
                  {companies.map((c) => (
                    <option key={c.id ?? GROUP} value={c.id === null ? GROUP : String(c.id)}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                id="holiday-date"
                label={t('date')}
                helper={t('dateHelper')}
                error={problem === 'date' ? t('dateMissing') : fieldError('date')}
              >
                <DateInput name="date" />
              </Field>
            </>
          ) : null}
          <Field
            id="holiday-name"
            label={t('name')}
            error={problem === 'name' ? t('nameMissing') : fieldError('name')}
          >
            <Input name="name" maxLength={120} defaultValue={holiday?.name ?? ''} />
          </Field>
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
