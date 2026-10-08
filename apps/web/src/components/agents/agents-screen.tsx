'use client';

import type {
  AgentAutonomy,
  AgentRoleKey,
  AgentSettingDto,
  AgentSettingsDto,
  AppliedAutonomyDto,
} from '@shakti/contracts';
import {
  Button,
  DataGrid,
  EmptyState,
  Field,
  Input,
  Select,
  StatusBadge,
  toast,
  type DataGridColumn,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { agentSettings, setAgentConfig, setKillSwitch } from '../../actions/agents';
import {
  actionTypeName,
  moneyFromPaise,
  paiseFromRupees,
  rupeesFromPaise,
} from '../../screens/agents';
import { AGENT_AUTONOMY_LEVELS, agentNameKey } from '../../screens/contract-values';
import { formatCount, formatRupees } from '../../screens/format';
import { FailureMessage } from '../screens/failure';
import { formText } from '../screens/form-data';
import { settle } from '../screens/settle';
import { useCommand } from '../screens/use-command';

/** Autonomy an agent may be given for every action type: Automatic is per action type only. */
const AGENT_LEVELS = AGENT_AUTONOMY_LEVELS.filter((a) => a !== 'automatic');

/**
 * Admin › Agents (docs/03-roadmap-appendix/phase1.md §7.1): every agent at the level being viewed, the company
 * chosen at the top or the whole group, with its kill switch, and for an Executive its autonomy,
 * its daily spending limit and the autonomy of each action type. Each autonomy shows what applies
 * now and where it comes from, and its empty choice names what it would inherit; at a company the
 * group's limit is shown too, since both apply. Automatic is shown unavailable in Phase 1. A switch
 * takes effect from the agent's next action; suggestions already in an inbox wait and cannot be
 * approved while it is off. Every change sends only the field it changes.
 */
export function AgentsScreen({
  initial,
  canSetAutonomy,
  companyName,
}: {
  initial: AgentSettingsDto;
  /** Holds `agents.autonomy.write`; the controls are read-only otherwise. */
  canSetAutonomy: boolean;
  /** The company being viewed, or undefined for the group. */
  companyName: string | undefined;
}) {
  const t = useTranslations('agents');
  const [settings, setSettings] = useState(initial);
  const config = useCommand(setAgentConfig);
  const switches = useCommand(setKillSwitch);
  const level = settings.entityId;
  const name = (agent: AgentRoleKey) => t(`names.${agentNameKey(agent)}`);
  const autonomyName = (a: AgentAutonomy) => t(`autonomy.${a}`);
  /** The empty choice: what applies with no setting at this level. */
  const inheritLabel = (inherited: AppliedAutonomyDto) =>
    t(`admin.inherit.${inherited.source}`, { autonomy: autonomyName(inherited.autonomy) });
  /** What applies now and where it comes from, with a stored Automatic's note. */
  const appliesNow = (applied: AppliedAutonomyDto) => (
    <p className="text-text-muted text-xs">
      {t('admin.appliesNow', {
        autonomy: autonomyName(applied.autonomy),
        source: t(`admin.source.${applied.source}`),
      })}
      {applied.automaticHeld ? ` ${t('admin.automaticHeld')}` : null}
    </p>
  );

  /** Reads the screen again after a change, so every derived status is the database's. */
  function reload(message: string) {
    toast.success(message);
    void settle(() => agentSettings()).then((result) => {
      if (result.ok) setSettings(result.data);
    });
  }

  function setSwitch(agent: AgentRoleKey | null, enabled: boolean) {
    switches.run({ agent, entityId: level, enabled }, () => {
      reload(
        agent === null
          ? t(enabled ? 'admin.allRunningToast' : 'admin.allStoppedToast')
          : t(enabled ? 'admin.agentRunning' : 'admin.agentStopped', { agent: name(agent) }),
      );
    });
  }

  function setAutonomy(row: AgentSettingDto, actionType: string | null, typed: string) {
    const autonomy = typed === '' ? null : (typed as AgentAutonomy);
    // Only the autonomy changes: the limit and the switch keep their values.
    config.run({ agent: row.agent, actionType, entityId: level, autonomy }, () => {
      reload(t('admin.autonomySaved', { agent: name(row.agent) }));
    });
  }

  const columns: DataGridColumn<AgentSettingDto>[] = [
    { id: 'agent', header: t('admin.columns.agent'), cell: (r) => name(r.agent), primary: true },
    {
      id: 'status',
      header: t('admin.columns.status'),
      cell: (r) =>
        r.stopped ? (
          <StatusBadge tone="danger">{t('admin.stopped')}</StatusBadge>
        ) : (
          <StatusBadge tone="success">{t('admin.running')}</StatusBadge>
        ),
    },
    {
      id: 'autonomy',
      header: t('admin.columns.autonomy'),
      cell: (r) => (
        <div className="flex min-w-56 flex-col gap-1">
          {canSetAutonomy ? (
            <Select
              aria-label={t('admin.autonomyLabel', { agent: name(r.agent) })}
              value={r.autonomy ?? ''}
              disabled={config.pending}
              onChange={(e) => {
                setAutonomy(r, null, e.target.value);
              }}
            >
              <option value="">{inheritLabel(r.inherited)}</option>
              {/* A stored Automatic is shown as it is stored, and cannot be chosen again. */}
              {(r.autonomy === 'automatic' ? AGENT_AUTONOMY_LEVELS : AGENT_LEVELS).map((a) => (
                <option
                  key={a}
                  value={a}
                  disabled={a === 'automatic' && !settings.automaticAvailable}
                >
                  {autonomyName(a)}
                </option>
              ))}
            </Select>
          ) : null}
          {appliesNow(r.effective)}
        </div>
      ),
    },
    {
      id: 'cap',
      header: t('admin.columns.cap'),
      cell: (r) =>
        canSetAutonomy ? (
          <CapForm row={r} level={level} name={name(r.agent)} onSaved={reload} />
        ) : (
          <div className="flex flex-col gap-1">
            {r.dailySpendCapPaise === null ? null : (
              <span>{formatRupees(moneyFromPaise(r.dailySpendCapPaise))}</span>
            )}
            <CapNote row={r} />
          </div>
        ),
    },
    {
      id: 'spent',
      header: t('admin.columns.spent'),
      numeric: true,
      // data-dynamic: today's spend changes with every run, so screenshots mask it.
      cell: (r) => <span data-dynamic>{formatRupees(moneyFromPaise(r.spentTodayPaise))}</span>,
    },
    {
      id: 'runs',
      header: t('admin.columns.runs'),
      numeric: true,
      cell: (r) => <span data-dynamic>{formatCount(r.runsToday)}</span>,
    },
    {
      id: 'actions',
      header: t('admin.columns.actions'),
      align: 'end',
      cell: (r) =>
        r.enabled ? (
          <Button
            size="sm"
            variant="secondary"
            aria-label={t('admin.stopLabel', { agent: name(r.agent) })}
            disabled={switches.pending}
            onClick={() => {
              setSwitch(r.agent, false);
            }}
          >
            {t('admin.stop')}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            aria-label={t('admin.runLabel', { agent: name(r.agent) })}
            disabled={switches.pending}
            onClick={() => {
              setSwitch(r.agent, true);
            }}
          >
            {t('admin.run')}
          </Button>
        ),
    },
  ];

  const withActions = settings.agents.filter((a) => a.actionTypes.length > 0);

  return (
    <div className="flex flex-col gap-8">
      <p className="text-text-muted">
        {companyName === undefined
          ? t('admin.levelGroup')
          : t('admin.levelCompany', { company: companyName })}
      </p>
      <section aria-labelledby="agents-all" className="flex flex-col gap-3">
        <h2 id="agents-all" className="text-h3">
          {t('admin.allHeading')}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <p role="status">{settings.allEnabled ? t('admin.allRunning') : t('admin.allStopped')}</p>
          <Button
            variant={settings.allEnabled ? 'danger' : 'secondary'}
            disabled={switches.pending}
            onClick={() => {
              setSwitch(null, !settings.allEnabled);
            }}
          >
            {settings.allEnabled ? t('admin.stopAll') : t('admin.runAll')}
          </Button>
        </div>
      </section>
      <FailureMessage failure={switches.failure ?? config.failure} />
      {canSetAutonomy ? null : <p className="text-text-muted">{t('admin.readOnly')}</p>}
      <DataGrid
        caption={t('admin.caption')}
        columns={columns}
        rows={settings.agents}
        rowKey={(r) => r.agent}
        empty={<EmptyState message={t('admin.noActionTypes')} />}
      />
      {withActions.map((row) => (
        <section
          key={row.agent}
          aria-labelledby={`agent-actions-${agentNameKey(row.agent)}`}
          className="flex flex-col gap-3"
        >
          <h2 id={`agent-actions-${agentNameKey(row.agent)}`} className="text-h3">
            {t('admin.actionTypesHeading', { agent: name(row.agent) })}
          </h2>
          <ul className="flex flex-col gap-3">
            {row.actionTypes.map((type) => {
              const key = actionTypeName(type.actionType);
              const label = key === undefined ? type.actionType : t(`actionTypes.${key}`);
              return (
                <li
                  key={type.actionType}
                  className="border-border flex flex-wrap items-end justify-between gap-4 rounded-lg border p-4"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="font-medium">{label}</p>
                    <p className="text-text-muted text-sm">
                      {t('admin.decisions', {
                        approved: formatCount(type.approvedUnedited),
                        decided: formatCount(type.decided),
                      })}
                    </p>
                    {settings.automaticAvailable ? null : (
                      <p className="text-text-muted text-sm">{t('admin.automaticUnavailable')}</p>
                    )}
                  </div>
                  <div className="flex w-72 max-w-full flex-col gap-1">
                    {canSetAutonomy ? (
                      <Select
                        aria-label={t('admin.actionTypeLabel', {
                          agent: name(row.agent),
                          action: label,
                        })}
                        value={type.autonomy ?? ''}
                        disabled={config.pending}
                        onChange={(e) => {
                          setAutonomy(row, type.actionType, e.target.value);
                        }}
                      >
                        <option value="">{inheritLabel(type.inherited)}</option>
                        {AGENT_AUTONOMY_LEVELS.map((a) => (
                          <option
                            key={a}
                            value={a}
                            disabled={a === 'automatic' && !settings.automaticAvailable}
                          >
                            {autonomyName(a)}
                          </option>
                        ))}
                      </Select>
                    ) : null}
                    {appliesNow(type.effective)}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** An agent's daily spending limit in rupees, saved on its own. */
function CapForm({
  row,
  level,
  name,
  onSaved,
}: {
  row: AgentSettingDto;
  level: number | null;
  name: string;
  onSaved: (message: string) => void;
}) {
  const t = useTranslations('agents');
  const { run, pending, failure } = useCommand(setAgentConfig);
  const [invalid, setInvalid] = useState(false);
  const id = `cap-${agentNameKey(row.agent)}`;

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const paise = paiseFromRupees(formText(new FormData(e.currentTarget), 'cap'));
    if (paise === undefined) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    // Only the limit changes: the autonomy and the switch keep their values.
    run({ agent: row.agent, actionType: null, entityId: level, dailySpendCapPaise: paise }, () => {
      onSaved(t('admin.capSaved', { agent: name }));
    });
  }

  return (
    <form onSubmit={submit} className="flex min-w-56 flex-col gap-1" noValidate>
      <div className="flex items-end gap-2">
        <Field
          id={id}
          label={t('admin.capLabel', { agent: name })}
          error={invalid ? t('admin.capInvalid') : undefined}
          className="flex-1 [&>label]:sr-only"
        >
          <Input
            name="cap"
            inputMode="decimal"
            defaultValue={rupeesFromPaise(row.dailySpendCapPaise)}
            autoComplete="off"
          />
        </Field>
        <Button type="submit" size="sm" variant="secondary" pending={pending}>
          {t('admin.saveCap')}
        </Button>
      </div>
      <CapNote row={row} />
      <FailureMessage failure={failure} />
    </form>
  );
}

/**
 * What limits the agent besides the limit set here: at a company the group's limit applies as
 * well; with no limit at all the agent makes no calls.
 */
function CapNote({ row }: { row: AgentSettingDto }) {
  const t = useTranslations('agents');
  const group = row.groupCapPaise;
  if (group !== null) {
    const amount = formatRupees(moneyFromPaise(group));
    return (
      <p className="text-text-muted text-xs">
        {row.dailySpendCapPaise === null
          ? t('admin.groupCapOnly', { amount })
          : t('admin.groupCapToo', { amount })}
      </p>
    );
  }
  return row.dailySpendCapPaise === null ? (
    <p className="text-text-muted text-xs">{t('admin.capNone')}</p>
  ) : null;
}
