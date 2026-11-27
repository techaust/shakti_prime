'use client';

import type { EmployeeDto, HrChoicesDto } from '@shakti/contracts';
import {
  Button,
  DateInput,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
  toast,
  type ReturnFocusTo,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type SyntheticEvent } from 'react';
import { createEmployee, getHrChoices, updateEmployee } from '../../actions/hr';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand, useQuery } from '../screens/use-command';
import type { CompanyOption } from './hr-text';

const NONE = '';

/**
 * HR's form for a person on the staff (docs/03-roadmap-appendix/phase5.md §5): a new person of
 * one company, or every detail of one already on the staff. The company's shifts, staff and
 * people with a sign-in there are read for the chosen company.
 */
export function EmployeeFormDialog({
  employee,
  companies,
  returnFocusTo,
  onClose,
  onSaved,
}: {
  employee: EmployeeDto | undefined;
  companies: readonly CompanyOption[];
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onSaved: (employee: EmployeeDto) => void;
}) {
  const t = useTranslations('hr.form');
  const common = useTranslations('common');
  const firstCompany = companies.find((c) => c.id !== null)?.id ?? null;
  const [entityId, setEntityId] = useState<number | null>(employee?.entityId ?? firstCompany);
  const [choices, setChoices] = useState<HrChoicesDto | undefined>();
  const choicesQuery = useQuery<HrChoicesDto>();
  const create = useCommand(createEmployee);
  const update = useCommand(updateEmployee);
  const { pending, failure } = employee === undefined ? create : update;
  const { fieldError, formFailure } = useFieldFailure(failure, [
    'name',
    'phone',
    'joinedOn',
    'office',
    'userId',
    'managerId',
    'shiftId',
  ]);
  const [problem, setProblem] = useState<'name' | 'joinedOn' | undefined>();
  const { load } = choicesQuery;

  useEffect(() => {
    if (entityId === null) return;
    load(
      () => getHrChoices({ entityId }),
      (data) => {
        setChoices(data);
      },
    );
  }, [entityId, load]);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || entityId === null) return;
    const data = new FormData(e.currentTarget);
    const name = formText(data, 'name');
    const joinedOn = formText(data, 'joinedOn');
    if (name.length === 0) {
      setProblem('name');
      return;
    }
    if (joinedOn === '') {
      setProblem('joinedOn');
      return;
    }
    setProblem(undefined);
    const optional = (field: string) => {
      const value = formText(data, field);
      return value === NONE ? null : value;
    };
    const fields = {
      userId: optional('userId'),
      name,
      phone: optional('phone'),
      managerId: optional('managerId'),
      shiftId: optional('shiftId'),
      office: optional('office'),
      joinedOn,
    };
    const done = (saved: EmployeeDto) => {
      toast.success(t('saved'));
      onSaved(saved);
    };
    if (employee === undefined) create.run({ ...fields, entityId }, done);
    else update.run({ ...fields, id: employee.id }, done);
  }

  const managers = (choices?.managers ?? []).filter((m) => m.id !== employee?.id);
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
              {employee === undefined ? t('addTitle') : t('editTitle', { name: employee.name })}
            </DialogTitle>
            <DialogDescription>{t('intro')}</DialogDescription>
          </DialogHeader>
          {employee === undefined && companies.length > 1 ? (
            <Field id="employee-company" label={t('company')}>
              <Select
                value={entityId === null ? NONE : String(entityId)}
                onChange={(e) => {
                  setChoices(undefined);
                  setEntityId(Number(e.currentTarget.value));
                }}
              >
                {companies
                  .filter((c) => c.id !== null)
                  .map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            </Field>
          ) : null}
          <FailureMessage failure={choicesQuery.failure} />
          <Field
            id="employee-name"
            label={t('name')}
            error={problem === 'name' ? t('nameMissing') : fieldError('name')}
          >
            <Input name="name" maxLength={120} defaultValue={employee?.name ?? ''} />
          </Field>
          <Field
            id="employee-sign-in"
            label={t('signIn')}
            helper={t('signInHelper')}
            error={fieldError('userId')}
          >
            {/* Remounted once the company's people are read, so the saved choice is shown. */}
            <Select
              key={choices === undefined ? 'loading' : 'ready'}
              name="userId"
              defaultValue={employee?.userId ?? NONE}
            >
              <option value={NONE}>{t('noSignIn')}</option>
              {employee?.userId == null ? null : (
                <option value={employee.userId}>{t('currentSignIn')}</option>
              )}
              {(choices?.people ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            id="employee-phone"
            label={t('phone')}
            helper={t('phoneHelper')}
            error={fieldError('phone')}
          >
            <Input
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              maxLength={20}
              defaultValue={employee?.phone ?? ''}
            />
          </Field>
          <Field id="employee-manager" label={t('manager')} error={fieldError('managerId')}>
            <Select
              key={choices === undefined ? 'loading' : 'ready'}
              name="managerId"
              defaultValue={employee?.managerId ?? NONE}
            >
              <option value={NONE}>{t('noManager')}</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="employee-shift" label={t('shift')} error={fieldError('shiftId')}>
            <Select
              key={choices === undefined ? 'loading' : 'ready'}
              name="shiftId"
              defaultValue={employee?.shiftId ?? NONE}
            >
              <option value={NONE}>{t('noShift')}</option>
              {(choices?.shifts ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="employee-office" label={t('office')} error={fieldError('office')}>
            <Input name="office" maxLength={80} defaultValue={employee?.office ?? ''} />
          </Field>
          <Field
            id="employee-joined"
            label={t('joinedOn')}
            helper={t('dateHelper')}
            error={problem === 'joinedOn' ? t('joinedOnMissing') : fieldError('joinedOn')}
          >
            <DateInput
              name="joinedOn"
              {...(employee === undefined ? {} : { defaultValue: employee.joinedOn })}
            />
          </Field>
          <FailureMessage failure={formFailure} />
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              {common('cancel')}
            </Button>
            <Button type="submit" pending={pending} disabled={choices === undefined}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
