'use client';

import type { LeaveRequestRowDto, LeaveScreenDto, LeaveToDecideDto } from '@shakti/contracts';
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
  Select,
  StatusBadge,
  Textarea,
  toast,
  useFocusTargets,
  type DataGridColumn,
  type ReturnFocusTo,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, type SyntheticEvent } from 'react';
import {
  approveLeave,
  cancelLeave,
  getLeaveScreen,
  rejectLeave,
  requestLeave,
} from '../../actions/hr';
import { formatDate } from '../../screens/format';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand, useQuery } from '../screens/use-command';
import { companyName, LEAVE_STATE_TONE, useLeaveStateText, type CompanyOption } from './hr-text';

interface Decision {
  kind: 'approve' | 'reject';
  request: LeaveToDecideDto;
}

/**
 * HR › Leave (docs/03-roadmap-appendix/phase5.md §5, PRD HR-02): a person asks for leave, sees
 * their balances and requests and takes back one that waits; an approver decides the requests of
 * the people they may decide for, never their own, seeing each person's balance.
 */
export function LeaveScreen({
  initial,
  companies,
  canDecide,
}: {
  initial: LeaveScreenDto;
  companies: readonly CompanyOption[];
  canDecide: boolean;
}) {
  const t = useTranslations('hr.leave');
  const hr = useTranslations('hr');
  const stateText = useLeaveStateText();
  const [screen, setScreen] = useState(initial);
  const [deciding, setDeciding] = useState<Decision | undefined>();
  const { load, failure } = useQuery<LeaveScreenDto>();
  const cancel = useCommand(cancelLeave);
  const decideButtons = useFocusTargets<string>();
  const several = screen.own.length > 1;

  function reload() {
    load(getLeaveScreen, setScreen);
  }

  const mine: DataGridColumn<LeaveRequestRowDto>[] = [
    {
      id: 'dates',
      header: t('columns.dates'),
      primary: true,
      cell: (r) => hr('span', { from: formatDate(r.fromDate), to: formatDate(r.toDate) }),
    },
    ...(several
      ? [
          {
            id: 'company',
            header: t('columns.company'),
            cell: (r: LeaveRequestRowDto) => companyName(companies, r.entityId),
          },
        ]
      : []),
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
    { id: 'note', header: t('columns.decisionNote'), cell: (r) => r.decisionNote ?? '' },
    {
      id: 'actions',
      header: <span className="sr-only">{t('columns.actions')}</span>,
      align: 'end',
      cell: (r) =>
        r.state === 'requested' ? (
          <Button
            variant="ghost"
            size="sm"
            pending={cancel.pending}
            aria-label={t('takeBackLabel', { from: formatDate(r.fromDate) })}
            onClick={() => {
              cancel.run({ id: r.id }, () => {
                toast.success(t('takenBack'));
                reload();
              });
            }}
          >
            {t('takeBack')}
          </Button>
        ) : null,
    },
  ];

  const waiting: DataGridColumn<LeaveToDecideDto>[] = [
    {
      id: 'person',
      header: t('columns.person'),
      primary: true,
      cell: (r) => (
        <Link href={`/hr/people/${r.employeeId}`} className="text-accent-text hover:underline">
          {r.employeeName}
        </Link>
      ),
    },
    {
      id: 'dates',
      header: t('columns.dates'),
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
      id: 'balance',
      header: t('columns.balance'),
      numeric: true,
      cell: (r) => hr('days', { count: r.balance }),
    },
    { id: 'note', header: t('columns.note'), cell: (r) => r.note ?? '' },
    {
      id: 'actions',
      header: <span className="sr-only">{t('columns.actions')}</span>,
      align: 'end',
      cell: (r) => (
        <span className="flex justify-end gap-2">
          <Button
            ref={decideButtons.ref(`approve-${r.id}`)}
            size="sm"
            aria-label={t('approveLabel', { name: r.employeeName })}
            onClick={() => {
              setDeciding({ kind: 'approve', request: r });
            }}
          >
            {t('approve')}
          </Button>
          <Button
            ref={decideButtons.ref(`reject-${r.id}`)}
            variant="secondary"
            size="sm"
            aria-label={t('rejectLabel', { name: r.employeeName })}
            onClick={() => {
              setDeciding({ kind: 'reject', request: r });
            }}
          >
            {t('reject')}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <FailureMessage failure={failure ?? cancel.failure} />
      <section className="flex flex-col gap-3" aria-labelledby="leave-ask">
        <h2 id="leave-ask" className="text-lg font-semibold">
          {t('askTitle')}
        </h2>
        {screen.own.length === 0 ? (
          <EmptyState message={t('noRecord')} />
        ) : screen.leaveTypes.length === 0 ? (
          <EmptyState message={t('noLeaveTypes')} />
        ) : (
          <AskForm screen={screen} companies={companies} onSaved={reload} />
        )}
      </section>
      {screen.own.length === 0 ? null : (
        <section className="flex flex-col gap-3" aria-labelledby="leave-mine">
          <h2 id="leave-mine" className="text-lg font-semibold">
            {t('mineTitle')}
          </h2>
          <ul className="flex flex-wrap gap-2" aria-label={t('balances')}>
            {screen.balances.map((b) => (
              <li
                key={`${b.employeeId}-${b.leaveTypeId}`}
                className="border-border rounded-lg border px-3 py-2"
              >
                {t('balanceLine', { type: b.leaveTypeName, days: hr('days', { count: b.days }) })}
              </li>
            ))}
            {screen.own.map((o) => (
              <li key={o.id}>
                <Link href={`/hr/people/${o.id}`} className="text-accent-text hover:underline">
                  {several
                    ? t('myRecordIn', { company: companyName(companies, o.entityId) })
                    : t('myRecord')}
                </Link>
              </li>
            ))}
          </ul>
          <DataGrid
            caption={t('mineCaption')}
            columns={mine}
            rows={screen.requests}
            rowKey={(r) => r.id}
            empty={<EmptyState message={t('noRequests')} />}
          />
        </section>
      )}
      {canDecide ? (
        <section className="flex flex-col gap-3" aria-labelledby="leave-decide">
          <h2 id="leave-decide" className="text-lg font-semibold">
            {t('decideTitle')}
          </h2>
          <DataGrid
            caption={t('decideCaption')}
            columns={waiting}
            rows={screen.toDecide}
            rowKey={(r) => r.id}
            empty={<EmptyState message={t('nothingToDecide')} />}
          />
        </section>
      ) : null}
      {deciding === undefined ? null : (
        <DecideDialog
          decision={deciding}
          returnFocusTo={() => [decideButtons.get(`${deciding.kind}-${deciding.request.id}`)]}
          onClose={() => {
            setDeciding(undefined);
          }}
          onSaved={() => {
            setDeciding(undefined);
            reload();
          }}
        />
      )}
    </div>
  );
}

/** Asks for leave for one of the caller's own staff records. */
function AskForm({
  screen,
  companies,
  onSaved,
}: {
  screen: LeaveScreenDto;
  companies: readonly CompanyOption[];
  onSaved: () => void;
}) {
  const t = useTranslations('hr.leave.form');
  const { run, pending, failure } = useCommand(requestLeave);
  const { fieldError, formFailure } = useFieldFailure(failure, [
    'leaveTypeId',
    'fromDate',
    'toDate',
    'note',
  ]);
  const [employeeId, setEmployeeId] = useState(screen.own[0]?.id ?? '');
  const [problem, setProblem] = useState<'from' | 'to' | undefined>();
  const [formKey, setFormKey] = useState(0);
  const entityId = screen.own.find((o) => o.id === employeeId)?.entityId;
  const types = screen.leaveTypes.filter((lt) => lt.entityId === null || lt.entityId === entityId);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const fromDate = formText(data, 'fromDate');
    const toDate = formText(data, 'toDate');
    if (fromDate === '') {
      setProblem('from');
      return;
    }
    if (toDate === '') {
      setProblem('to');
      return;
    }
    setProblem(undefined);
    const note = formText(data, 'note');
    run(
      {
        employeeId,
        leaveTypeId: formText(data, 'leaveTypeId'),
        fromDate,
        toDate,
        note: note === '' ? null : note,
      },
      (asked) => {
        toast.success(t('saved', { days: asked.days }));
        setFormKey((k) => k + 1);
        onSaved();
      },
    );
  }

  return (
    <form key={formKey} onSubmit={submit} className="flex max-w-xl flex-col gap-4" noValidate>
      {screen.own.length > 1 ? (
        <Field id="leave-record" label={t('company')}>
          <Select
            value={employeeId}
            onChange={(e) => {
              setEmployeeId(e.currentTarget.value);
            }}
          >
            {screen.own.map((o) => (
              <option key={o.id} value={o.id}>
                {companyName(companies, o.entityId)}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field id="leave-type" label={t('leaveType')} error={fieldError('leaveTypeId')}>
        <Select name="leaveTypeId" key={employeeId} defaultValue={types[0]?.id}>
          {types.map((lt) => (
            <option key={lt.id} value={lt.id}>
              {lt.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="leave-from"
          label={t('fromDate')}
          helper={t('dateHelper')}
          error={problem === 'from' ? t('dateMissing') : fieldError('fromDate')}
        >
          <DateInput name="fromDate" />
        </Field>
        <Field
          id="leave-to"
          label={t('toDate')}
          helper={t('dateHelper')}
          error={problem === 'to' ? t('dateMissing') : fieldError('toDate')}
        >
          <DateInput name="toDate" />
        </Field>
      </div>
      <Field id="leave-note" label={t('note')} helper={t('noteHelper')} error={fieldError('note')}>
        <Textarea name="note" maxLength={500} />
      </Field>
      <FailureMessage failure={formFailure} />
      <div>
        <Button type="submit" pending={pending}>
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}

/** An approver's decision on one waiting request, with a note if they wish. */
function DecideDialog({
  decision,
  returnFocusTo,
  onClose,
  onSaved,
}: {
  decision: Decision;
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('hr.leave.decide');
  const hr = useTranslations('hr');
  const common = useTranslations('common');
  const approve = useCommand(approveLeave);
  const reject = useCommand(rejectLeave);
  const command = decision.kind === 'approve' ? approve : reject;
  const { request } = decision;

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (command.pending) return;
    const note = formText(new FormData(e.currentTarget), 'note');
    command.run({ id: request.id, note: note === '' ? null : note }, () => {
      toast.success(decision.kind === 'approve' ? t('approved') : t('rejected'));
      onSaved();
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
              {decision.kind === 'approve'
                ? t('approveTitle', { name: request.employeeName })
                : t('rejectTitle', { name: request.employeeName })}
            </DialogTitle>
            <DialogDescription>
              {t('summary', {
                type: request.leaveTypeName,
                span: hr('span', {
                  from: formatDate(request.fromDate),
                  to: formatDate(request.toDate),
                }),
                days: hr('days', { count: request.days }),
                balance: hr('days', { count: request.balance }),
              })}
            </DialogDescription>
          </DialogHeader>
          <Field id="decide-note" label={t('note')} helper={t('noteHelper')}>
            <Textarea name="note" maxLength={500} />
          </Field>
          <FailureMessage failure={command.failure} />
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              {common('cancel')}
            </Button>
            <Button
              type="submit"
              variant={decision.kind === 'approve' ? 'primary' : 'danger'}
              pending={command.pending}
            >
              {decision.kind === 'approve' ? t('approveSubmit') : t('rejectSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
