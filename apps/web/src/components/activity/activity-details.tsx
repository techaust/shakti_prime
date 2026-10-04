'use client';

import type { AuditLogDto } from '@shakti/contracts';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  StatusBadge,
  type ReturnFocusTo,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { ErrorKey, PermissionNameKey, RoleNameKey } from '../../i18n/types';
import {
  actionKey,
  auditChanges,
  CONFIRM_METHODS,
  eventNameKey,
  oneOf,
  SIGN_IN_DETAILS,
  wordsOf,
  type ChangeRow,
  type ChangeValue,
  type CodeGroup,
} from '../../screens/audit';
import {
  CONTRASTS,
  FILE_PURPOSES,
  FILE_SANITISING,
  FILE_SCAN_VERDICTS,
  FILE_STATUSES,
  IMPLEMENTED_IMPORT_KINDS,
  IMPORT_JOB_STATES,
  OPPORTUNITY_LOST_REASONS,
  OPPORTUNITY_NURTURE_REASONS,
  OPPORTUNITY_STATES,
  PDF_DOCUMENT_TYPES,
  PRICE_TIER_CODES,
  SAVED_VIEW_SCREENS,
  SEGMENTS,
  SESSION_REVOKE_REASONS,
  THEMES,
  USER_STATUSES,
} from '../../screens/contract-values';
import { formatDate, formatDateTime, formatRupees } from '../../screens/format';
import { fileTypeKey, SCAN_STATUSES } from '../../screens/files';
import { LEAD_IMPORT_FIELDS } from '../../screens/import-wizard';
import { isScopeChoice, permissionMessageKey } from '../../screens/roles';
import { useCatalogueText } from '../catalogue/use-spec-text';
import { useDeviceName } from '../users/sessions-sheet';
import { OUTCOME_TONE } from './outcome';

/**
 * The Activity log's detail sheet for one row, loaded on demand by the log screen and shown while
 * it is mounted; closing it calls `onClose`.
 */
export function ActivityDetailsSheet({
  row,
  companies,
  closeLabel,
  returnFocusTo,
  onClose,
}: {
  row: AuditLogDto;
  companies: Record<number, string>;
  closeLabel: string;
  /** Where focus goes when the sheet closes: the row's View button. */
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
}) {
  return (
    <Sheet
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <SheetContent closeLabel={closeLabel} returnFocusTo={returnFocusTo}>
        <ActivityDetails row={row} companies={companies} />
      </SheetContent>
    </Sheet>
  );
}

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
            <h4 className="font-semibold">{t('sheet.other')}</h4>
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
          <span className="font-medium">
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
  const roleEditor = useTranslations('adminRoles');
  const theme = useTranslations('theme');
  const code = useCodeText();
  const leadField = useLeadFieldName();
  const catalogue = useCatalogueText();
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
      case 'date':
        return /^\d{4}-\d{2}-\d{2}$/.test(value.iso) ? formatDate(value.iso) : value.iso;
      case 'percent':
        return t('values.percent', { value: value.value });
      case 'code':
        return code(value.group, value.value);
      case 'specs':
        return (
          <span className="flex flex-col">
            {value.entries.map((e) => (
              <span key={e.key}>
                {t('values.spec', {
                  name: catalogue.specLabel(e.key),
                  value: catalogue.specValue(e.key, e.value),
                })}
              </span>
            ))}
          </span>
        );
      case 'mapping':
        return (
          <span className="flex flex-col">
            {value.columns.map((c) => (
              <span key={`column-${c.field}`}>
                {t('values.mappingColumn', { field: leadField(c.field), column: c.column })}
              </span>
            ))}
            {value.defaults.map((d) => (
              <span key={`default-${d.field}`}>
                {t('values.mappingDefault', { field: leadField(d.field), value: wordsOf(d.value) })}
              </span>
            ))}
          </span>
        );
      case 'userStatus': {
        const status = value.value;
        return oneOf(USER_STATUSES, status) ? users(`status.${status}`) : wordsOf(status);
      }
      case 'theme': {
        const choice = value.value;
        return oneOf(THEMES, choice) ? theme(choice) : wordsOf(choice);
      }
      case 'contrast': {
        const choice = value.value;
        return oneOf(CONTRASTS, choice) ? t(`values.contrast.${choice}`) : wordsOf(choice);
      }
      case 'role':
        return roles.has(value.value as RoleNameKey)
          ? roles(value.value as RoleNameKey)
          : wordsOf(value.value);
      case 'viewSettings':
        return t('values.viewSettings', {
          hidden: value.hidden,
          filters: value.filters,
          sorted: value.sorted ? 'yes' : 'no',
          density: value.density,
        });
      case 'endReason': {
        const ended = value.value;
        return oneOf(SESSION_REVOKE_REASONS, ended)
          ? users(`sessions.reason.${ended}`)
          : wordsOf(ended);
      }
      case 'grants':
        return value.grants.length === 0 ? (
          <span className="text-text-muted">{roleEditor('scope.none')}</span>
        ) : (
          <span className="flex flex-col">
            {value.grants.map((g) => {
              const name = permissionMessageKey(g.permission);
              return (
                <span key={g.permission}>
                  {t('values.grant', {
                    permission: roleEditor.has(
                      `permissions.${name}` as `permissions.${PermissionNameKey}`,
                    )
                      ? roleEditor(`permissions.${name}` as `permissions.${PermissionNameKey}`)
                      : wordsOf(g.permission),
                    scope: isScopeChoice(g.scope)
                      ? roleEditor(`scope.${g.scope}`)
                      : wordsOf(g.scope),
                  })}
                </span>
              );
            })}
          </span>
        );
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

/** A lead field of an import's column matching, by its name on the import screens. */
function useLeadFieldName(): (field: string) => string {
  const imports = useTranslations('imports');
  return (field) => {
    return oneOf(LEAD_IMPORT_FIELDS, field) ? imports(`fields.${field}`) : wordsOf(field);
  };
}

/**
 * A coded value in words, from the catalogue that names it on its own screen; a code no
 * catalogue names yet reads in plain words rather than as raw data.
 */
function useCodeText(): (group: CodeGroup, value: string) => string {
  const t = useTranslations('activity');
  const leads = useTranslations('leads');
  const imports = useTranslations('imports');
  const errors = useTranslations('errors');
  const priceMaster = useTranslations('priceMaster');
  const catalogue = useCatalogueText();
  const files = useTranslations('files');
  return (group, value) => {
    switch (group) {
      case 'state': {
        if (oneOf(OPPORTUNITY_STATES, value)) return leads(`state.${value}`);
        return oneOf(IMPORT_JOB_STATES, value) ? imports(`state.${value}`) : wordsOf(value);
      }
      case 'lostReason':
        return oneOf(OPPORTUNITY_LOST_REASONS, value)
          ? leads(`board.lostReason.${value}`)
          : wordsOf(value);
      case 'nurtureReason':
        return oneOf(OPPORTUNITY_NURTURE_REASONS, value)
          ? leads(`board.nurtureReason.${value}`)
          : wordsOf(value);
      case 'importKind':
        return oneOf(IMPLEMENTED_IMPORT_KINDS, value)
          ? imports(`upload.kinds.${value}`)
          : wordsOf(value);
      case 'fileType':
        return value.toUpperCase();
      case 'segment':
        return oneOf(SEGMENTS, value) ? t(`values.segment.${value}`) : wordsOf(value);
      case 'errorCode':
        return errors.has(value as ErrorKey) ? errors(value as ErrorKey) : errors('internal');
      case 'signInDetail':
        return oneOf(SIGN_IN_DETAILS, value) ? t(`values.signInDetail.${value}`) : wordsOf(value);
      case 'method':
        return oneOf(CONFIRM_METHODS, value) ? t(`values.method.${value}`) : wordsOf(value);
      case 'eventType': {
        const name = eventNameKey(value);
        // A type the catalogue does not know yet reads in plain words, not as its dotted code.
        return name === undefined ? wordsOf(value.replaceAll('.', ' ')) : t(`events.${name}`);
      }
      case 'screen':
        return oneOf(SAVED_VIEW_SCREENS, value) ? t(`values.screen.${value}`) : wordsOf(value);
      case 'itemCategory':
        return catalogue.category(value);
      case 'itemUnit':
        return catalogue.unit(value);
      case 'priceTier':
        return oneOf(PRICE_TIER_CODES, value) ? priceMaster(`tiers.${value}`) : wordsOf(value);
      case 'fileStatus':
        return oneOf(FILE_STATUSES, value) ? files(`status.${value}`) : wordsOf(value);
      case 'filePurpose':
        return oneOf(FILE_PURPOSES, value) ? files(`purpose.${value}`) : wordsOf(value);
      case 'contentType': {
        const type = fileTypeKey(value);
        return type === undefined ? wordsOf(value.replaceAll('/', ' ')) : files(`types.${type}`);
      }
      case 'scanVerdict':
        return oneOf(FILE_SCAN_VERDICTS, value) ? files(`verdict.${value}`) : wordsOf(value);
      case 'sanitising':
        return oneOf(FILE_SANITISING, value) ? files(`sanitising.${value}`) : wordsOf(value);
      case 'scanStatus':
        return oneOf(SCAN_STATUSES, value) ? files(`scanStatus.${value}`) : wordsOf(value);
      case 'documentType':
        return oneOf(PDF_DOCUMENT_TYPES, value)
          ? t(`values.documentType.${value}`)
          : wordsOf(value);
    }
  };
}
