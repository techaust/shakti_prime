'use client';

import type { RoleGrantsDto, RolePermissionDto } from '@shakti/contracts';
import { Button, Field, Select, toast } from '@shakti/ui';
import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useRef, useState } from 'react';
import type { ModuleNameKey, PermissionNameKey } from '../../i18n/types';
import {
  byModule,
  choicesFor,
  costWarning,
  grantsOf,
  hasChanges,
  initialChoices,
  isScopeChoice,
  permissionMessageKey,
  summarise,
  type ChangeSummary,
  type Choices,
} from '../../screens/roles';

/** The save dialog, fetched when the Executive first saves rather than with the page. */
const SaveRoleDialog = dynamic(() => import('./save-role-dialog').then((m) => m.SaveRoleDialog));

/**
 * One staff role's permissions (docs/03-roadmap-appendix/phase1.md §6.2): the catalogue grouped by module with
 * a scope picker for each, offering only the scopes the permission honours, a locked line with its
 * reason where the role may not choose, a running summary of what the choices change, and a save
 * that names how many people are signed out before it runs. A request narrowed to some companies
 * sees why it cannot save instead.
 */
export function RoleEditor({ initial, holdsRole }: { initial: RoleGrantsDto; holdsRole: boolean }) {
  const t = useTranslations('adminRoles');
  const names = useTranslations('roles');
  const [role, setRole] = useState(initial.role);
  const [saved, setSaved] = useState<Choices>(() => initialChoices(initial.permissions));
  const [chosen, setChosen] = useState<Choices>(saved);
  const [version, setVersion] = useState(initial.version);
  const [confirming, setConfirming] = useState(false);
  const saveButton = useRef<HTMLButtonElement>(null);
  const summaryLine = useRef<HTMLParagraphElement>(null);
  const summary = summarise(saved, chosen);
  const changed = hasChanges(summary);
  const canSave = initial.groupScope && changed;
  const roleName = names(role.key);

  return (
    <div className="flex flex-col gap-8 pb-4">
      {initial.groupScope ? null : (
        <p className="border-border bg-warning-soft flex items-start gap-2 rounded-md border px-3 py-2">
          <TriangleAlert aria-hidden className="text-warning mt-0.5 size-4 shrink-0" />
          <span>{t('groupScopeNotice')}</span>
        </p>
      )}
      <p className="text-text-muted">{t('people', { count: role.holderCount })}</p>
      {byModule(initial.permissions).map((group) => (
        <fieldset key={group.module} className="flex flex-col gap-4">
          <legend className="text-h3 mb-3">{t(`modules.${group.module as ModuleNameKey}`)}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {group.permissions.map((p) => (
              <PermissionChoice
                key={p.key}
                permission={p}
                value={chosen[p.key] ?? 'none'}
                onChange={(value) => {
                  setChosen((all) => ({ ...all, [p.key]: value }));
                }}
              />
            ))}
          </div>
        </fieldset>
      ))}
      <div className="bg-bg border-border sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 md:-mx-6 md:px-6">
        {/* Takes focus after a save, when the Save button has nothing left to save. */}
        <p ref={summaryLine} tabIndex={-1} className="text-text-muted text-sm" aria-live="polite">
          <SummaryText summary={summary} />
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={!changed}
            onClick={() => {
              setChosen(saved);
            }}
          >
            {t('reset')}
          </Button>
          <Button
            ref={saveButton}
            disabled={!canSave}
            onClick={() => {
              setConfirming(true);
            }}
          >
            {t('save')}
          </Button>
        </div>
      </div>
      {confirming ? (
        <SaveRoleDialog
          roleKey={role.key}
          roleName={roleName}
          grants={grantsOf(initial.permissions, chosen)}
          expectedVersion={version}
          summary={<SummaryText summary={summary} />}
          holderCount={role.holderCount}
          holdsRole={holdsRole}
          returnFocusTo={() => [saveButton.current, summaryLine.current]}
          onSaved={(result) => {
            setSaved(chosen);
            setVersion(result.version);
            setRole((r) => ({
              ...r,
              grantCount: result.grantCount,
              customisedAt: result.customisedAt,
            }));
            setConfirming(false);
            toast.success(t('done', { role: roleName }));
          }}
          onClose={() => {
            setConfirming(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** "2 permissions given, 1 narrowed", or that nothing has changed yet. */
function SummaryText({ summary }: { summary: ChangeSummary }) {
  const t = useTranslations('adminRoles');
  if (!hasChanges(summary)) return t('summary.none');
  const parts = (['added', 'removed', 'widened', 'narrowed'] as const)
    .filter((k) => summary[k] > 0)
    .map((k) => t(`summary.${k}`, { count: summary[k] }));
  return parts.join(', ');
}

function PermissionChoice({
  permission,
  value,
  onChange,
}: {
  permission: RolePermissionDto;
  value: Choices[string];
  onChange: (value: Choices[string]) => void;
}) {
  const t = useTranslations('adminRoles');
  const id = `grant-${permissionMessageKey(permission.key)}`;
  const name = t(`permissions.${permissionMessageKey(permission.key) as PermissionNameKey}`);
  if (permission.locked !== null) {
    // Read-only text a keyboard can still reach, with the reason read out after the value.
    return (
      <div className="flex flex-col gap-1.5">
        <span id={`${id}-label`} className="text-text-muted text-sm font-medium">
          {name}
        </span>
        <p
          id={id}
          tabIndex={0}
          aria-labelledby={`${id}-label ${id}`}
          aria-describedby={`${id}-note`}
          className="border-border text-text rounded-md border border-dashed px-3 py-2"
        >
          {t(`scope.${value}`)}
        </p>
        <p id={`${id}-note`} className="text-text-subtle text-xs">
          {t(`locked.${permission.locked}`)}
        </p>
      </div>
    );
  }
  const warning = costWarning(permission.key);
  const helper =
    warning === undefined ? undefined : (
      <span className="text-warning flex items-start gap-1.5">
        <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <span>{t(warning)}</span>
      </span>
    );
  return (
    <Field id={id} label={name} helper={helper}>
      <Select
        value={value}
        onChange={(e) => {
          const next = e.currentTarget.value;
          if (isScopeChoice(next)) onChange(next);
        }}
      >
        {choicesFor(permission).map((choice) => (
          <option key={choice} value={choice}>
            {t(`scope.${choice}`)}
          </option>
        ))}
      </Select>
    </Field>
  );
}
