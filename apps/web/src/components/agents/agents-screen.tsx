'use client';

import type {
  AgentAutonomy,
  AgentRoleKey,
  AgentSettingDto,
  AgentSettingsDto,
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
 * Admin › Agents (docs/design/phase1.md §7.1): every agent at the level being viewed, the company
 * chosen at the top or the whole group, with its kill switch, and for an Executive its autonomy,
 * its daily spending limit and the autonomy of each action type. A switch takes effect from the
 * agent's next action; suggestions already in an inbox wait and cannot be approved while it is off.
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
    config.run(
      {
        agent: row.agent,
        actionType,
        entityId: level,
        autonomy,
        // A cap lives on the agent's own row; an action type's row has none.
        dailySpendCapPaise: actionType === null ? row.dailySpendCapPaise : null,
      },
      () => {
        reload(t('admin.autonomySaved', { agent: name(row.agent) }));
      },
    );
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
      cell: (r) =>
        canSetAutonomy ? (
          <Select
            aria-label={t('admin.autonomyLabel', { agent: name(r.agent) })}
            value={r.autonomy ?? ''}
            disabled={config.pending}
            onChange={(e) => {
              setAutonomy(r, null, e.target.value);
            }}
          >
            <option value="">{t('admin.autonomyUnset')}</option>
            {AGENT_LEVELS.map((a) => (
              <option key={a} value={a}>
                {t(`autonomy.${a}`)}
              </option>
            ))}
          </Select>
        ) : r.autonomy === null ? (
          t('admin.autonomyUnset')
        ) : (
          t(`autonomy.${r.autonomy}`)
        ),
    },
    {
      id: 'cap',
      header: t('admin.columns.cap'),
      cell: (r) =>
        canSetAutonomy ? (
          <CapForm row={r} level={level} name={name(r.agent)} onSaved={reload} />
        ) : r.dailySpendCapPaise === null ? (
          t('admin.capNone')
        ) : (
          formatRupees(moneyFromPaise(r.dailySpendCapPaise))
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
                    {type.automaticEarned ? null : (
                      <p className="text-text-muted text-sm">{t('admin.automaticLocked')}</p>
                    )}
                  </div>
                  <div className="w-64 max-w-full">
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
                        <option value="">
                          {t('admin.sameAsAgent', {
                            autonomy: t(`autonomy.${row.autonomy ?? 'suggest'}`),
                          })}
                        </option>
                        {AGENT_AUTONOMY_LEVELS.map((a) => (
                          <option
                            key={a}
                            value={a}
                            disabled={a === 'automatic' && !type.automaticEarned}
                          >
                            {t(`autonomy.${a}`)}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <p>{t(`autonomy.${type.effectiveAutonomy}`)}</p>
                    )}
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
    run(
      {
        agent: row.agent,
        actionType: null,
        entityId: level,
        autonomy: row.autonomy,
        dailySpendCapPaise: paise,
      },
      () => {
        onSaved(t('admin.capSaved', { agent: name }));
      },
    );
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
      {row.dailySpendCapPaise === null ? (
        <p className="text-text-muted text-xs">{t('admin.capNone')}</p>
      ) : null}
      <FailureMessage failure={failure} />
    </form>
  );
}
