'use client';

import {
  SessionRevokeReasonSchema,
  ThemeSchema,
  UserStatusSchema,
  type AuditLogDto,
} from '@shakti/contracts';
import { SheetDescription, SheetHeader, SheetTitle, StatusBadge } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { ErrorKey, RoleNameKey } from '../../i18n/types';
import {
  actionKey,
  auditChanges,
  wordsOf,
  type ChangeRow,
  type ChangeValue,
} from '../../screens/audit';
import { formatDateTime, formatRupees } from '../../screens/format';
import { useDeviceName } from '../users/sessions-sheet';
import { OUTCOME_TONE } from './outcome';

/**
 * One recorded action in a side sheet: who, when, where from, the result and, field by field,
 * what changed. Values read as words, amounts and dates; ids and raw data are never shown.
 */
export function ActivityDetails({
  row,
  companies,
}: {
  row: AuditLogDto;
  companies: Record<number, string>;
}) {
  const t = useTranslations('activity');
  const errors = useTranslations('errors');
  const deviceName = useDeviceName();
  const changes = auditChanges(row.before, row.after);
  const named = changes.filter((c) => c.field !== undefined);
  const other = changes.filter((c) => c.field === undefined);
  const why =
    row.errorCode !== null && errors.has(row.errorCode as ErrorKey)
      ? errors(row.errorCode as ErrorKey)
      : undefined;

  const facts: [string, ReactNode][] = [
    [t('sheet.when'), formatDateTime(row.createdAt)],
    [t('sheet.person'), row.actorName ?? t('system')],
    [
      t('sheet.company'),
      row.entityId === null ? t('noCompany') : (companies[row.entityId] ?? t('noCompany')),
    ],
    [
      t('sheet.outcome'),
      <StatusBadge key="outcome" tone={OUTCOME_TONE[row.outcome]}>
        {t(`outcome.${row.outcome}`)}
      </StatusBadge>,
    ],
  ];
  if (why !== undefined) facts.push([t('sheet.why'), why]);
  if (row.ip !== null)
    facts.push([
      t('sheet.address'),
      <span key="ip" className="break-all">
        {row.ip}
      </span>,
    ]);
  if (row.device !== null) facts.push([t('sheet.device'), deviceName(row.device)]);
  if (row.requestId !== null) {
    facts.push([
      t('sheet.reference'),
      <span key="reference" className="break-all">
        {row.requestId}
      </span>,
    ]);
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>
          {t('sheet.title', { action: t(`actions.${actionKey(row.command)}`) })}
        </SheetTitle>
        <SheetDescription>{formatDateTime(row.createdAt)}</SheetDescription>
      </SheetHeader>
      <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-2">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-text-muted text-sm">{label}</dt>
            <dd className="min-w-0">{value}</dd>
          </div>
        ))}
      </dl>
      <section className="flex flex-col gap-3">
        <h3 className="text-h3">{t('sheet.changes')}</h3>
        {named.length === 0 && other.length === 0 ? (
          <p className="text-text-muted">{t('sheet.noChanges')}</p>
        ) : (
          <ChangeList rows={named} companies={companies} />
        )}
        {other.length === 0 ? null : (
          <>
            <h4 className="font-[590]">{t('sheet.other')}</h4>
            <ChangeList rows={other} companies={companies} />
          </>
        )}
      </section>
    </>
  );
}

function ChangeList({ rows, companies }: { rows: ChangeRow[]; companies: Record<number, string> }) {
  const t = useTranslations('activity');
  if (rows.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((c) => (
        <li
          key={c.field ?? c.label}
          className="border-border flex flex-col gap-1 rounded-lg border p-3 text-sm"
        >
          <span className="font-[510]">
            {c.field === undefined ? c.label : t(`fields.${c.field}`)}
          </span>
          <span className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2">
            <span className="text-text-muted">{t('sheet.before')}</span>
            <Value value={c.before} companies={companies} />
            <span className="text-text-muted">{t('sheet.after')}</span>
            <Value value={c.after} companies={companies} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function Value({ value, companies }: { value: ChangeValue; companies: Record<number, string> }) {
  const t = useTranslations('activity');
  const common = useTranslations('common');
  const users = useTranslations('users');
  const roles = useTranslations('roles');
  const theme = useTranslations('theme');
  const text = (() => {
    switch (value.kind) {
      case 'empty':
        return <span className="text-text-muted">{t('sheet.empty')}</span>;
      case 'text':
        return value.text;
      case 'number':
        return String(value.value);
      case 'yesNo':
        return value.value ? common('yes') : common('no');
      case 'money':
        return /^-?\d+(\.\d{1,2})?$/.test(value.amount) ? formatRupees(value.amount) : value.amount;
      case 'time':
        return formatDateTime(value.iso);
      case 'userStatus': {
        const status = UserStatusSchema.safeParse(value.value);
        return status.success ? users(`status.${status.data}`) : wordsOf(value.value);
      }
      case 'theme': {
        const choice = ThemeSchema.safeParse(value.value);
        return choice.success ? theme(choice.data) : wordsOf(value.value);
      }
      case 'endReason': {
        const ended = SessionRevokeReasonSchema.safeParse(value.value);
        return ended.success ? users(`sessions.reason.${ended.data}`) : wordsOf(value.value);
      }
      case 'roles':
        return value.roles.length === 0 ? (
          <span className="text-text-muted">{users('rolesField.none')}</span>
        ) : (
          <span className="flex flex-col">
            {value.roles.map((r) => (
              <span key={r.entityId}>
                {users('roleIn', {
                  company: companies[r.entityId] ?? '',
                  role: roles.has(r.roleKey as RoleNameKey)
                    ? roles(r.roleKey as RoleNameKey)
                    : r.roleKey,
                })}
              </span>
            ))}
          </span>
        );
    }
  })();
  return <span className="min-w-0 break-words">{text}</span>;
}
