'use client';

import type {
  EmployeeSheetDto,
  LeaveBalanceDto,
  LeaveMovementRowDto,
  LeaveRequestRowDto,
} from '@shakti/contracts';
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
  StatusBadge,
  Textarea,
  toast,
  type DataGridColumn,
  type ReturnFocusTo,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { adjustLeave, deactivateEmployee } from '../../actions/hr';
import { formatDate, formatDateTime, formatPhone } from '../../screens/format';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';
import {
  companyName,
  LEAVE_STATE_TONE,
  useLeaveStateText,
  useWeekdayText,
  type CompanyOption,
} from './hr-text';

const EmployeeFormDialog = dynamic(() =>
  import('./employee-form').then((m) => m.EmployeeFormDialog),
);

type Open = 'edit' | 'leave' | 'balance';

/**
 * A person's page (docs/03-roadmap-appendix/phase5.md §5, PRD HR-01 and HR-02): their details,
 * shift and manager, each leave balance, and their newest requests and balance changes. HR edits
 * the record, records the day the person left and grants or corrects leave.
 */
export function PersonScreen({
  sheet,
  companies,
  canEdit,
}: {
  sheet: EmployeeSheetDto;
  companies: readonly CompanyOption[];
  canEdit: boolean;
}) {
  const t = useTranslations('hr.person');
  const hr = useTranslations('hr');
  const router = useRouter();
  const weekdays = useWeekdayText();
  const stateText = useLeaveStateText();
  const [open, setOpen] = useState<Open | undefined>();
  const opener = useRef<HTMLButtonElement | null>(null);
  const { employee, shift } = sheet;
  const editable = canEdit && employee.active;

  const ask = (what: Open, button: HTMLButtonElement) => {
    opener.current = button;
    setOpen(what);
  };
  const close = () => {
    setOpen(undefined);
  };
  const saved = () => {
    setOpen(undefined);
    router.refresh();
  };
  const returnFocusTo: ReturnFocusTo = () => [opener.current];

  const details: [string, ReactNode][] = [
    [t('company'), companyName(companies, employee.entityId)],
    [
      t('status'),
      <StatusBadge key="status" tone={employee.active ? 'success' : 'neutral'}>
        {employee.active
          ? hr('onStaff')
          : t('leftOn', { date: formatDate(employee.leftOn ?? employee.joinedOn) })}
      </StatusBadge>,
    ],
    [t('phone'), employee.phone === null ? hr('none') : formatPhone(employee.phone)],
    [t('manager'), sheet.managerName ?? hr('none')],
    [
      t('shift'),
      shift === null
        ? hr('none')
        : t('shiftLine', {
            name: shift.name,
            start: shift.startTime,
            end: shift.endTime,
            daysOff: weekdays(shift.weeklyOffDays),
          }),
    ],
    [t('office'), employee.office ?? hr('none')],
    [t('joinedOn'), formatDate(employee.joinedOn)],
    [t('signsIn'), employee.userId === null ? hr('no') : hr('yes')],
  ];

  const balanceColumns: DataGridColumn<LeaveBalanceDto>[] = [
    { id: 'type', header: t('columns.leaveType'), primary: true, cell: (b) => b.leaveTypeName },
    {
      id: 'days',
      header: t('columns.days'),
      numeric: true,
      cell: (b) => hr('days', { count: b.days }),
    },
  ];
  const requestColumns: DataGridColumn<LeaveRequestRowDto>[] = [
    {
      id: 'dates',
      header: t('columns.dates'),
      primary: true,
      cell: (r) => hr('span', { from: formatDate(r.fromDate), to: formatDate(r.toDate) }),
    },
    { id: 'type', header: t('columns.leaveType'), cell: (r) => r.leaveTypeName },
    {
      id: 'days',
      header: t('columns.days'),
      numeric: true,
      cell: (r) => hr('days', { count: r.days }),
    },
    {
      id: 'state',
      header: t('columns.state'),
      cell: (r) => <StatusBadge tone={LEAVE_STATE_TONE[r.state]}>{stateText(r.state)}</StatusBadge>,
    },
    { id: 'note', header: t('columns.note'), cell: (r) => r.decisionNote ?? r.note ?? '' },
  ];
  const movementColumns: DataGridColumn<LeaveMovementRowDto>[] = [
    {
      id: 'when',
      header: t('columns.when'),
      primary: true,
      cell: (m) => formatDateTime(m.createdAt),
    },
    { id: 'type', header: t('columns.leaveType'), cell: (m) => m.leaveTypeName },
    { id: 'kind', header: t('columns.change'), cell: (m) => hr(`movement.${m.kind}`) },
    {
      id: 'days',
      header: t('columns.days'),
      numeric: true,
      cell: (m) => hr('signedDays', { count: m.days }),
    },
    { id: 'reason', header: t('columns.reason'), cell: (m) => m.reason ?? '' },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {editable ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={(e) => {
              ask('edit', e.currentTarget);
            }}
          >
            {t('edit')}
          </Button>
          <Button
            variant="secondary"
            onClick={(e) => {
              ask('balance', e.currentTarget);
            }}
          >
            {t('changeBalance')}
          </Button>
          <Button
            variant="ghost"
            onClick={(e) => {
              ask('leave', e.currentTarget);
            }}
          >
            {t('markLeft')}
          </Button>
        </div>
      ) : null}
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
        {details.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-text-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <section className="flex flex-col gap-2" aria-labelledby="person-balances">
        <h2 id="person-balances" className="text-lg font-semibold">
          {t('balances')}
        </h2>
        <DataGrid
          caption={t('balancesCaption')}
          columns={balanceColumns}
          rows={sheet.balances}
          rowKey={(b) => b.leaveTypeId}
          empty={<EmptyState message={t('noLeaveTypes')} />}
        />
      </section>
      <section className="flex flex-col gap-2" aria-labelledby="person-requests">
        <h2 id="person-requests" className="text-lg font-semibold">
          {t('requests')}
        </h2>
        <DataGrid
          caption={t('requestsCaption')}
          columns={requestColumns}
          rows={sheet.requests}
          rowKey={(r) => r.id}
          empty={<EmptyState message={t('noRequests')} />}
        />
      </section>
      <section className="flex flex-col gap-2" aria-labelledby="person-movements">
        <h2 id="person-movements" className="text-lg font-semibold">
          {t('movements')}
        </h2>
        <DataGrid
          caption={t('movementsCaption')}
          columns={movementColumns}
          rows={sheet.movements}
          rowKey={(m) => m.id}
          empty={<EmptyState message={t('noMovements')} />}
        />
      </section>
      {open === 'edit' ? (
        <EmployeeFormDialog
          employee={employee}
          companies={companies}
          returnFocusTo={returnFocusTo}
          onClose={close}
          onSaved={saved}
        />
      ) : open === undefined ? null : (
        <Frame returnFocusTo={returnFocusTo} onClose={close}>
          {open === 'leave' ? (
            <LeftForm
              employeeId={employee.id}
              name={employee.name}
              onClose={close}
              onSaved={saved}
            />
          ) : (
            <BalanceForm
              employeeId={employee.id}
              name={employee.name}
              balances={sheet.balances}
              onClose={close}
              onSaved={saved}
            />
          )}
        </Frame>
      )}
    </div>
  );
}

function Frame({
  returnFocusTo,
  onClose,
  children,
}: {
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  children: ReactNode;
}) {
  const common = useTranslations('common');
  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent closeLabel={common('close')} returnFocusTo={returnFocusTo}>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** Records the day a person left. */
function LeftForm({
  employeeId,
  name,
  onClose,
  onSaved,
}: {
  employeeId: string;
  name: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('hr.person.leftForm');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(deactivateEmployee);
  const { fieldError, formFailure } = useFieldFailure(failure, ['leftOn']);
  const [missing, setMissing] = useState(false);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const leftOn = formText(new FormData(e.currentTarget), 'leftOn');
    if (leftOn === '') {
      setMissing(true);
      return;
    }
    setMissing(false);
    run({ id: employeeId, leftOn }, () => {
      toast.success(t('saved'));
      onSaved();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{t('title', { name })}</DialogTitle>
        <DialogDescription>{t('intro')}</DialogDescription>
      </DialogHeader>
      <Field
        id="employee-left-on"
        label={t('leftOn')}
        helper={t('dateHelper')}
        error={missing ? t('leftOnMissing') : fieldError('leftOn')}
      >
        <DateInput name="leftOn" />
      </Field>
      <FailureMessage failure={formFailure} />
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          {common('cancel')}
        </Button>
        <Button type="submit" variant="danger" pending={pending}>
          {t('submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}

const DAYS = /^-?\d{1,3}(\.[05])?$/;

/** HR grants days of a leave type, or corrects a balance either way, with a reason. */
function BalanceForm({
  employeeId,
  name,
  balances,
  onClose,
  onSaved,
}: {
  employeeId: string;
  name: string;
  balances: readonly LeaveBalanceDto[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('hr.person.balanceForm');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(adjustLeave);
  const { fieldError, formFailure } = useFieldFailure(failure, ['days', 'reason', 'leaveTypeId']);
  const [problem, setProblem] = useState<'days' | 'reason' | undefined>();

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const kind = formText(data, 'kind');
    const daysText = formText(data, 'days');
    const reason = formText(data, 'reason');
    const days = Number(daysText);
    if (!DAYS.test(daysText) || days === 0 || (kind === 'grant' && days < 0)) {
      setProblem('days');
      return;
    }
    if (reason.length === 0) {
      setProblem('reason');
      return;
    }
    setProblem(undefined);
    run({ employeeId, leaveTypeId: formText(data, 'leaveTypeId'), kind, days, reason }, () => {
      toast.success(t('saved'));
      onSaved();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{t('title', { name })}</DialogTitle>
        <DialogDescription>{t('intro')}</DialogDescription>
      </DialogHeader>
      {balances.length === 0 ? (
        <EmptyState message={t('noLeaveTypes')} />
      ) : (
        <>
          <Field id="balance-type" label={t('leaveType')} error={fieldError('leaveTypeId')}>
            <Select name="leaveTypeId" defaultValue={balances[0]?.leaveTypeId}>
              {balances.map((b) => (
                <option key={b.leaveTypeId} value={b.leaveTypeId}>
                  {b.leaveTypeName}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="balance-kind" label={t('kind')}>
            <Select name="kind" defaultValue="grant">
              <option value="grant">{t('grant')}</option>
              <option value="adjust">{t('adjust')}</option>
            </Select>
          </Field>
          <Field
            id="balance-days"
            label={t('days')}
            helper={t('daysHelper')}
            error={problem === 'days' ? t('daysInvalid') : fieldError('days')}
          >
            <Input name="days" inputMode="decimal" autoComplete="off" maxLength={6} />
          </Field>
          <Field
            id="balance-reason"
            label={t('reason')}
            error={problem === 'reason' ? t('reasonMissing') : fieldError('reason')}
          >
            <Textarea name="reason" maxLength={300} />
          </Field>
        </>
      )}
      <FailureMessage failure={formFailure} />
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          {common('cancel')}
        </Button>
        {balances.length === 0 ? null : (
          <Button type="submit" pending={pending}>
            {t('submit')}
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}
