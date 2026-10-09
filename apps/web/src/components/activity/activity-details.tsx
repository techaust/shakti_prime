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
  COMMISSION_BASES,
  DISPOSITION_NEXT_ACTIONS,
  ACCOUNT_TYPES,
  AGENT_ACTION_STATE_VALUES,
  AGENT_AUTONOMY_LEVELS,
  AGENT_ROLES,
  AGENT_RUN_OUTCOME_VALUES,
  agentNameKey,
  KNOWLEDGE_FILE_STATE_VALUES,
  KNOWLEDGE_SENSITIVITY_VALUES,
  KNOWLEDGE_SOURCE_VALUES,
  CONSENT_CHANNELS,
  CONSENT_PURPOSES,
  CONSENT_SOURCES,
  CONTRASTS,
  CUSTOMER_LANGUAGES,
  DUPLICATE_REASONS,
  DUPLICATE_STATES,
  FILE_PURPOSES,
  FILE_SANITISING,
  FILE_SCAN_VERDICTS,
  FILE_STATUSES,
  IMPLEMENTED_IMPORT_KINDS,
  IMPORT_JOB_STATES,
  QUOTE_STATES,
  SALES_ORDER_STATES,
  TARGET_METRICS,
  TARGET_PERIODS,
  TARGET_SCOPES,
  QUOTE_ACCEPTED_VIA,
  COMMISSION_ACCRUAL_STATES,
  OPPORTUNITY_LOST_REASONS,
  OPPORTUNITY_NURTURE_REASONS,
  OPPORTUNITY_STATES,
  PDF_DOCUMENT_TYPES,
  PRICE_TIER_CODES,
  SAVED_VIEW_SCREENS,
  SCORE_FACTORS,
  SEGMENTS,
  SESSION_REVOKE_REASONS,
  STAGE_EXIT_FIELDS,
  SIZING_KINDS,
  SIZING_REASONS,
  SITE_TYPES,
  TASK_KINDS,
  TASK_STATES,
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
  const settings = useTranslations('pipelineSettings');
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
      case 'stageFields':
        return value.fields
          .map((f) => (oneOf(STAGE_EXIT_FIELDS, f) ? settings(`stageField.${f}`) : wordsOf(f)))
          .join(', ');
      case 'codes':
        return value.values.map((v) => code(value.group, v)).join(t('values.listSeparator'));
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
  const settings = useTranslations('pipelineSettings');
  const sizing = useTranslations('sizing');
  const customers = useTranslations('customers');
  const priceMaster = useTranslations('priceMaster');
  const catalogue = useCatalogueText();
  const files = useTranslations('files');
  const duplicates = useTranslations('duplicates');
  const quotes = useTranslations('quotes');
  const orders = useTranslations('orders');
  const agents = useTranslations('agents');
  const knowledge = useTranslations('knowledge');
  const targets = useTranslations('targets');
  return (group, value) => {
    switch (group) {
      case 'state': {
        if (oneOf(OPPORTUNITY_STATES, value)) return leads(`state.${value}`);
        if (oneOf(TASK_STATES, value)) return customers(`tasks.state.${value}`);
        if (oneOf(AGENT_ACTION_STATE_VALUES, value)) return agents(`actionState.${value}`);
        if (oneOf(DUPLICATE_STATES, value)) return duplicates(`state.${value}`);
        if (oneOf(IMPORT_JOB_STATES, value)) return imports(`state.${value}`);
        return oneOf(QUOTE_STATES, value) ? quotes(`state.${value}`) : wordsOf(value);
      }
      case 'orderState':
        return oneOf(SALES_ORDER_STATES, value) ? orders(`state.${value}`) : wordsOf(value);
      case 'acceptedVia':
        return oneOf(QUOTE_ACCEPTED_VIA, value) ? orders(`acceptedVia.${value}`) : wordsOf(value);
      case 'targetScope':
        return oneOf(TARGET_SCOPES, value) ? targets(`scope.${value}`) : wordsOf(value);
      case 'targetMetric':
        return oneOf(TARGET_METRICS, value) ? targets(`metric.${value}`) : wordsOf(value);
      case 'targetPeriod':
        return oneOf(TARGET_PERIODS, value) ? targets(`period.${value}`) : wordsOf(value);
      case 'commissionState':
        return oneOf(COMMISSION_ACCRUAL_STATES, value)
          ? orders(`commissionState.${value}`)
          : wordsOf(value);
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
      case 'accountType':
        return oneOf(ACCOUNT_TYPES, value) ? leads(`accountType.${value}`) : wordsOf(value);
      case 'language':
        return oneOf(CUSTOMER_LANGUAGES, value) ? leads(`language.${value}`) : wordsOf(value);
      case 'siteType':
        return oneOf(SITE_TYPES, value) ? leads(`siteType.${value}`) : wordsOf(value);
      case 'consentChannel':
        return oneOf(CONSENT_CHANNELS, value)
          ? customers(`consent.channel.${value}`)
          : wordsOf(value);
      case 'consentPurpose':
        return oneOf(CONSENT_PURPOSES, value)
          ? customers(`consent.purpose.${value}`)
          : wordsOf(value);
      case 'consentSource':
        return oneOf(CONSENT_SOURCES, value)
          ? customers(`consent.source.${value}`)
          : wordsOf(value);
      case 'taskKind':
        return oneOf(TASK_KINDS, value) ? customers(`tasks.kind.${value}`) : wordsOf(value);
      case 'screen':
        return oneOf(SAVED_VIEW_SCREENS, value) ? t(`values.screen.${value}`) : wordsOf(value);
      case 'nextAction':
        return oneOf(DISPOSITION_NEXT_ACTIONS, value)
          ? settings(`nextAction.${value}`)
          : wordsOf(value);
      case 'scoreFactor':
        return oneOf(SCORE_FACTORS, value) ? settings(`factor.${value}`) : wordsOf(value);
      case 'commissionBasis':
        return oneOf(COMMISSION_BASES, value) ? settings(`basis.${value}`) : wordsOf(value);
      case 'sizingKind':
        return oneOf(SIZING_KINDS, value) ? sizing(`kind.${value}`) : wordsOf(value);
      case 'sizingReason':
        return oneOf(SIZING_REASONS, value) ? sizing(`reason.${value}`) : wordsOf(value);
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
      case 'duplicateReason':
        return oneOf(DUPLICATE_REASONS, value) ? duplicates(`reason.${value}`) : wordsOf(value);
      case 'agent':
        return oneOf(AGENT_ROLES, value) ? agents(`names.${agentNameKey(value)}`) : wordsOf(value);
      case 'agentAction': {
        // An action type is the command it runs, named as the Activity log names that command.
        const key = actionKey(value);
        return key === 'other' ? wordsOf(value.replaceAll('.', ' ')) : t(`actions.${key}`);
      }
      case 'autonomy':
        return oneOf(AGENT_AUTONOMY_LEVELS, value) ? agents(`autonomy.${value}`) : wordsOf(value);
      case 'runOutcome':
        return oneOf(AGENT_RUN_OUTCOME_VALUES, value) ? agents(`outcome.${value}`) : wordsOf(value);
      case 'knowledgeState':
        return oneOf(KNOWLEDGE_FILE_STATE_VALUES, value)
          ? knowledge(`state.${value}`)
          : wordsOf(value);
      case 'knowledgeSensitivity':
        return oneOf(KNOWLEDGE_SENSITIVITY_VALUES, value)
          ? knowledge(`sensitivity.${value}`)
          : wordsOf(value);
      case 'knowledgeSource':
        return oneOf(KNOWLEDGE_SOURCE_VALUES, value)
          ? knowledge(`source.${value}`)
          : wordsOf(value);
    }
  };
}
