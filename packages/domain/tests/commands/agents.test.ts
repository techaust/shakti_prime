import { newId, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  createTestUser,
  principalFor,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentPrincipal } from '../../src/ai/runtime';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { failureOf, runCommand } from '../../src/command/run-command';
import { setAgentConfig, setKillSwitch } from '../../src/commands/agents/config';
import {
  approveInboxItem,
  dismissInboxItem,
  editInboxItem,
  rejectInboxItem,
} from '../../src/commands/agents/inbox';
import { recordAgentRun } from '../../src/commands/agents/record-run';
import { createLead } from '../../src/commands/crm/create-lead';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';

// agents.run.record, agents.inbox.approve, .edit, .reject and .dismiss, agents.config.set and
// agents.killswitch.set (docs/design/phase1.md §7.1): an agent records its runs and files
// suggestions as itself; a person approves a Needs approval one, and the command runs as that
// person, or dismisses a Suggest one, which they act on themselves; the agent controls set
// autonomy, caps and kill switches. Each test writes its own company's settings, replacing any row
// a run left with the same key, and removes them, so no other suite finds an agent stopped.

const HOUR = 3_600_000;
const later = (hours = 24): string => new Date(Date.now() + hours * HOUR).toISOString();
const reason = (r: string) => ({ details: { reason: r } });
const TASK = 'crm.task.create';

const madeConfigs: string[] = [];
afterAll(async () => {
  await asMigrator(async (m) => {
    await m`delete from agent_configs where id = any(${madeConfigs})`;
  });
  await closeDb();
});

function run(principal: Principal, command: AnyCommand, input: unknown): Promise<unknown> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  );
}

/** A setting written as the owner, replacing any row with the same agent, action type and company. */
async function setting(row: {
  agent?: string | null;
  actionType?: string | null;
  entityId: number | null;
  autonomy?: string | null;
  cap?: number | null;
  enabled?: boolean;
}): Promise<string> {
  const id = newId();
  madeConfigs.push(id);
  const agent = row.agent === undefined ? 'agent:copilot' : row.agent;
  await asMigrator(async (m) => {
    await m`delete from agent_configs where agent is not distinct from ${agent}
                     and action_type is not distinct from ${row.actionType ?? null} and entity_id is not distinct from ${row.entityId}`;
    await m`insert into agent_configs (id, agent, action_type, entity_id, autonomy, daily_spend_cap_paise, enabled, created_by)
             values (${id}, ${agent}, ${row.actionType ?? null},
                     ${row.entityId}, ${row.autonomy ?? null}, ${row.cap ?? null}, ${row.enabled ?? true},
                     ${executive.id})`;
  });
  return id;
}

async function drop(id: string): Promise<void> {
  await asMigrator((m) => m`delete from agent_configs where id = ${id}`);
}

const phone = (): string => `95${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

async function leadOf(owner: Principal, entityId = 1): Promise<string> {
  const lead = (await run(owner, createLead, {
    entityId,
    pipelineKey: 'farmer_pumps',
    contact: { name: 'Agent inbox customer', phone: phone() },
    account: { type: 'farm' },
  })) as { id: string };
  return lead.id;
}

interface RunAnswer {
  runId: string;
  outcome: string;
  actionId: string | null;
  inboxItemId: string | null;
}

const copilot = (entityId = 1) => agentPrincipal('agent:copilot', entityId);

function runInput(entityId: number, opportunityId: string | null, extra: object = {}) {
  return {
    entityId,
    agent: 'agent:copilot',
    purpose: 'follow_up',
    actionType: TASK,
    model: 'claude-haiku-4-5-20251001',
    tokensIn: 1200,
    tokensOut: 80,
    costPaise: 17,
    durationMs: 900,
    ended: 'completed',
    ...(opportunityId === null
      ? {}
      : {
          proposal: {
            input: { entityId, opportunityId, kind: 'follow_up', dueAt: later() },
            subjectType: 'opportunity',
            subjectId: opportunityId,
            assigneeId: caller.id,
          },
        }),
    ...extra,
  };
}

/** A suggestion filed in company 1 under the autonomy the settings give it there. */
async function suggest(opportunityId: string, proposalInput: object = {}): Promise<RunAnswer> {
  const input = runInput(1, opportunityId) as ReturnType<typeof runInput> & {
    proposal: { input: Record<string, unknown> };
  };
  return (await run(copilot(), recordAgentRun, {
    ...input,
    proposal: { ...input.proposal, input: { ...input.proposal.input, ...proposalInput } },
  })) as RunAnswer;
}

/** A suggestion in company 1 whose task and item are for `assigneeId`. */
function suggestTo(opportunityId: string, assigneeId: string): Promise<unknown> {
  const input = runInput(1, opportunityId) as ReturnType<typeof runInput> & {
    proposal: Record<string, unknown>;
  };
  return run(copilot(), recordAgentRun, { ...input, proposal: { ...input.proposal, assigneeId } });
}

/** Waits until a transaction waits for the agent's settings lock, held by another one. */
async function waitForSettingsLock(): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const [row] = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from pg_locks
         where locktype = 'advisory' and not granted
           and ((classid::bigint << 32) | objid::bigint) = hashtextextended('agent-config:agent:copilot', 0)`,
    );
    if ((row?.n ?? 0) > 0) return;
    if (Date.now() > deadline) throw new Error('the approval never waited for the switch');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** A suggestion filed under Suggest: the person acts on it themselves. */
async function suggestOnly(opportunityId: string): Promise<RunAnswer> {
  const mode = await setting({ entityId: 1, actionType: TASK, autonomy: 'suggest' });
  try {
    return await suggest(opportunityId);
  } finally {
    await setting({ entityId: 1, actionType: TASK, autonomy: 'needs_approval' });
    await drop(mode);
  }
}

let teamId: string;
let caller: Principal;
let otherCaller: Principal;
let gm: Principal;
let executive: Principal;
let lead: string;

beforeAll(async () => {
  teamId = await createTestTeam(1, 'agent inbox team');
  const user = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc', teamId }]);
  caller = await createTestPrincipal('tele_caller_cc', [1], { id: user.id, teamId });
  otherCaller = await createTestPrincipal('tele_caller_cc', [1], { teamId });
  gm = await createTestPrincipal('general_manager', [1]);
  executive = await createTestPrincipal('executive');
  lead = await leadOf(caller);
  // The Caller Co-pilot's follow-ups need approval in company 1, so a person decides on them.
  await setting({ entityId: 1, actionType: TASK, autonomy: 'needs_approval' });
});

describe('agents.run.record', () => {
  it('records a run with nothing to do, which the agent cannot read back and the controls can', async () => {
    const answer = (await run(copilot(), recordAgentRun, runInput(1, null))) as RunAnswer;
    expect(answer).toMatchObject({ outcome: 'nothing_to_do', actionId: null, inboxItemId: null });
    const [row] = await asMigrator(
      (m) => m<{ cost_paise: string; principal_id: string; outcome: string }[]>`
        select cost_paise, principal_id, outcome from agent_runs where id = ${answer.runId}`,
    );
    expect(row).toEqual({
      cost_paise: '17',
      principal_id: copilot().id,
      outcome: 'nothing_to_do',
    });
  });

  it('files a suggestion and its inbox item, which the assignee reads', async () => {
    const answer = await suggest(lead);
    expect(answer).toMatchObject({ outcome: 'proposed' });
    const seen = await asPrincipal(caller, async ({ tx }) => {
      const rows = (await tx.execute(
        sql`select count(*)::int as n from inbox_items where id = ${answer.inboxItemId}`,
      )) as unknown as { n: number }[];
      return rows[0]?.n;
    });
    expect(seen).toBe(1);
    const [item] = await asMigrator(
      (m) => m<{ state: string; assignee_id: string; agent_action_id: string }[]>`
        select state, assignee_id, agent_action_id from inbox_items where id = ${answer.inboxItemId}`,
    );
    expect(item).toEqual({
      state: 'open',
      assignee_id: caller.id,
      agent_action_id: answer.actionId,
    });
  });

  it('fills the task’s assignee from the inbox item, and refuses a task for an agent', async () => {
    const answer = await suggest(lead);
    const [action] = await asMigrator(
      (m) => m<{ input: { assigneeId: string } }[]>`
        select input_json as input from agent_actions where id = ${answer.actionId}`,
    );
    expect(action?.input.assigneeId).toBe(caller.id);
    await expect(suggest(lead, { assigneeId: copilot().id })).rejects.toMatchObject(
      reason('agent_proposal_invalid'),
    );
    const noOne = runInput(1, lead) as ReturnType<typeof runInput> & {
      proposal: Record<string, unknown>;
    };
    const unassigned = Object.fromEntries(
      Object.entries(noOne.proposal).filter(([key]) => key !== 'assigneeId'),
    );
    await expect(
      run(copilot(), recordAgentRun, { ...noOne, proposal: unassigned }),
    ).rejects.toMatchObject(reason('agent_proposal_invalid'));
  });

  it('files an item only for a person with a role in the company, and takes their team there', async () => {
    const answer = await suggest(lead);
    const [item] = await asMigrator(
      (m) => m<{ team_id: string | null }[]>`
        select team_id from inbox_items where id = ${answer.inboxItemId}`,
    );
    expect(item?.team_id).toBe(teamId);
    // The agent cannot name a team: the proposal has no such field.
    const named = runInput(1, lead) as ReturnType<typeof runInput> & {
      proposal: Record<string, unknown>;
    };
    await expect(
      run(copilot(), recordAgentRun, { ...named, proposal: { ...named.proposal, teamId } }),
    ).rejects.toMatchObject({ code: 'validation_failed' });

    const noRole = await createTestPrincipal('tele_caller_cc', [1]);
    const elsewhere = await createTestUser([{ entityId: 2, roleKey: 'tele_caller_cc' }]);
    const archived = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc' }]);
    await asMigrator((m) => m`update principals set archived_at = now() where id = ${archived.id}`);
    for (const someone of [noRole.id, elsewhere.id, archived.id, newId()]) {
      await expect(suggestTo(lead, someone)).rejects.toMatchObject(
        reason('agent_proposal_invalid'),
      );
    }
  });

  it('is refused to a person, and to an agent recording for another agent', async () => {
    const person = run(executive, recordAgentRun, runInput(1, null));
    await expect(person).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      run(agentPrincipal('agent:triage', 1), recordAgentRun, runInput(1, null)),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('is refused for an action type the agent does not take, at the guard when it lacks the permission', async () => {
    await expect(
      run(agentPrincipal('agent:triage', 1), recordAgentRun, {
        ...runInput(1, null),
        agent: 'agent:triage',
      }),
    ).rejects.toMatchObject(reason('agent_action_not_open'));
    const error = await run(agentPrincipal('agent:chief', 1), recordAgentRun, {
      ...runInput(1, null),
      agent: 'agent:chief',
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'forbidden' });
    expect(failureOf(error)?.stage).toBe('guard');
  });

  it('is refused for another company, and for a proposal about a lead the run does not read', async () => {
    await expect(run(copilot(1), recordAgentRun, runInput(2, null))).rejects.toMatchObject({
      code: 'forbidden',
    });
    const otherCompanyLead = await leadOf(await createTestPrincipal('general_manager', [2]), 2);
    const input = runInput(1, lead) as ReturnType<typeof runInput> & {
      proposal: { input: Record<string, unknown>; subjectId: string };
    };
    await expect(
      run(copilot(), recordAgentRun, {
        ...input,
        proposal: { ...input.proposal, subjectId: otherCompanyLead },
      }),
    ).rejects.toMatchObject(reason('agent_proposal_invalid'));
    // The input and the subject agree, but the lead is in company 2.
    await expect(
      run(copilot(), recordAgentRun, {
        ...input,
        proposal: {
          ...input.proposal,
          input: { ...input.proposal.input, opportunityId: otherCompanyLead },
          subjectId: otherCompanyLead,
        },
      }),
    ).rejects.toMatchObject(reason('agent_proposal_invalid'));
  });

  it('records the run as stopped, and files nothing, while a switch is off', async () => {
    const off = await setting({ entityId: 1, enabled: false });
    try {
      const answer = await suggest(lead);
      expect(answer).toMatchObject({ outcome: 'switched_off', actionId: null, inboxItemId: null });
    } finally {
      await drop(off);
    }
  });

  it('files a stored Automatic as Needs approval in Phase 1: nothing runs as the agent', async () => {
    const automatic = await setting({ entityId: 1, actionType: TASK, autonomy: 'automatic' });
    try {
      const answer = await suggest(lead);
      expect(answer).toMatchObject({ outcome: 'proposed' });
      expect(answer.inboxItemId).not.toBeNull();
      const [action] = await asMigrator(
        (m) => m<{ state: string; autonomy: string }[]>`
          select state, autonomy from agent_actions where id = ${answer.actionId}`,
      );
      expect(action).toEqual({ state: 'proposed', autonomy: 'needs_approval' });
    } finally {
      await setting({ entityId: 1, actionType: TASK, autonomy: 'needs_approval' });
      await drop(automatic);
    }
  });
});

describe('agents.inbox.approve, .edit and .reject', () => {
  it('approving runs the command as the person who approves', async () => {
    const answer = await suggest(lead);
    const decided = await run(caller, approveInboxItem, {
      entityId: 1,
      itemId: answer.inboxItemId,
    });
    expect(decided).toMatchObject({ state: 'approved', edited: false });
    const [task] = await asMigrator(
      (m) => m<{ created_by: string; assignee_id: string; kind: string }[]>`
        select created_by, assignee_id, kind from tasks where opportunity_id = ${lead}
         order by created_at desc limit 1`,
    );
    expect(task).toEqual({ created_by: caller.id, assignee_id: caller.id, kind: 'follow_up' });
    const [action] = await asMigrator(
      (m) => m<{ state: string; decided_by: string; edited: boolean }[]>`
        select state, decided_by, edited from agent_actions where id = ${answer.actionId}`,
    );
    expect(action).toEqual({ state: 'approved', decided_by: caller.id, edited: false });
    const audited = await asMigrator(
      (m) => m<{ command: string; actor_principal_id: string }[]>`
        select command, actor_principal_id from audit_logs
         where aggregate_id = ${answer.actionId} and command = 'agents.inbox.approve'`,
    );
    expect(audited).toEqual([{ command: 'agents.inbox.approve', actor_principal_id: caller.id }]);
  });

  it('takes a decision once', async () => {
    const answer = await suggest(lead);
    await run(caller, rejectInboxItem, { entityId: 1, itemId: answer.inboxItemId });
    await expect(
      run(caller, approveInboxItem, { entityId: 1, itemId: answer.inboxItemId }),
    ).rejects.toMatchObject(reason('inbox_item_transition_not_allowed'));
  });

  it('takes one of two decisions made at once, in two transactions', async () => {
    const answer = await suggest(lead);
    const input = { entityId: 1, itemId: answer.inboxItemId };
    const both = await Promise.allSettled([
      run(caller, approveInboxItem, input),
      run(caller, rejectInboxItem, input),
    ]);
    const done = both.filter((r) => r.status === 'fulfilled');
    const refused = both.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(done).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]?.reason).toMatchObject(reason('inbox_item_transition_not_allowed'));
    const [counts] = await asMigrator(
      (m) => m<{ decisions: number }[]>`
        select count(*)::int as decisions from audit_logs
         where aggregate_id = ${answer.actionId} and outcome = 'ok'
           and command in ('agents.inbox.approve', 'agents.inbox.reject')`,
    );
    expect(counts?.decisions).toBe(1);
  });

  it('is refused to a role without the inbox, to an agent, to someone it is not for, and in another company', async () => {
    const answer = await suggest(lead);
    const input = { entityId: 1, itemId: answer.inboxItemId };
    const field = await createTestPrincipal('field_engineer', [1]);
    await expect(run(field, approveInboxItem, input)).rejects.toMatchObject({ code: 'forbidden' });
    const withInbox = principalFor('agent:copilot', [1], {
      permissions: [{ key: 'agents.inbox.act', scope: 'entity' }],
    });
    await expect(run(withInbox, approveInboxItem, input)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(run(otherCaller, approveInboxItem, input)).rejects.toMatchObject(
      reason('inbox_item_missing'),
    );
    const elsewhere = await createTestPrincipal('general_manager', [2]);
    await expect(run(elsewhere, approveInboxItem, input)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(run(elsewhere, rejectInboxItem, input)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('is refused while a kill switch stops the agent; rejecting still closes it', async () => {
    const answer = await suggest(lead);
    const off = await setting({ entityId: 1, enabled: false });
    try {
      await expect(
        run(caller, approveInboxItem, { entityId: 1, itemId: answer.inboxItemId }),
      ).rejects.toMatchObject(reason('agent_switched_off'));
      await expect(
        run(caller, rejectInboxItem, { entityId: 1, itemId: answer.inboxItemId }),
      ).resolves.toMatchObject({ state: 'rejected' });
    } finally {
      await drop(off);
    }
  });

  it('an approval waits for a switch being turned off, and then sees it', async () => {
    const answer = await suggest(lead);
    let approval: Promise<unknown> | undefined;
    const switched = await run(gm, setKillSwitch, {
      agent: 'agent:copilot',
      entityId: 1,
      enabled: true,
    });
    madeConfigs.push((switched as { id: string }).id);
    // The switch goes off in a transaction held open while the approval starts.
    await asPrincipal(gm, async (context) => {
      await runCommand(
        setKillSwitch,
        { context, audit, outbox },
        {
          agent: 'agent:copilot',
          entityId: 1,
          enabled: false,
        },
      );
      approval = run(caller, approveInboxItem, { entityId: 1, itemId: answer.inboxItemId }).catch(
        (e: unknown) => e,
      );
      // The approval waits for the switch's lock before the switch commits.
      await waitForSettingsLock();
    });
    try {
      expect(await approval).toMatchObject(reason('agent_switched_off'));
    } finally {
      await run(gm, setKillSwitch, { agent: 'agent:copilot', entityId: 1, enabled: true });
    }
  });

  it('editing changes only the fields a person may change, and counts as edited', async () => {
    const answer = await suggest(lead);
    const due = later(72);
    await expect(
      run(caller, editInboxItem, {
        entityId: 1,
        itemId: answer.inboxItemId,
        changes: { kind: 'callback' },
      }),
    ).rejects.toMatchObject(reason('agent_field_not_editable'));
    const decided = await run(caller, editInboxItem, {
      entityId: 1,
      itemId: answer.inboxItemId,
      changes: { dueAt: due, title: 'Ask about the borewell' },
    });
    expect(decided).toMatchObject({ state: 'approved', edited: true });
    const [task] = await asMigrator(
      (m) => m<{ due_at: Date; title: string }[]>`
        select due_at, title from tasks where opportunity_id = ${lead} order by created_at desc limit 1`,
    );
    expect(task?.due_at.toISOString()).toBe(new Date(due).toISOString());
    expect(task?.title).toBe('Ask about the borewell');
  });

  it('an edit with no change counts as unedited: the same moment written another way', async () => {
    const due = new Date(Date.now() + 30 * HOUR);
    due.setUTCSeconds(0, 0);
    const answer = await suggest(lead, { dueAt: due.toISOString() });
    // The same moment in India time, as the edit form sends it.
    const ist = new Date(due.getTime() + 330 * 60_000).toISOString().slice(0, 16);
    const decided = await run(caller, editInboxItem, {
      entityId: 1,
      itemId: answer.inboxItemId,
      changes: { dueAt: `${ist}+05:30` },
    });
    expect(decided).toMatchObject({ state: 'approved', edited: false });
    const none = await suggest(lead);
    await expect(
      run(caller, editInboxItem, { entityId: 1, itemId: none.inboxItemId, changes: {} }),
    ).resolves.toMatchObject({ state: 'approved', edited: false });
  });

  it('an edit needs a time with its offset', async () => {
    const answer = await suggest(lead);
    await expect(
      run(caller, editInboxItem, {
        entityId: 1,
        itemId: answer.inboxItemId,
        changes: { dueAt: '2031-01-02T09:30' },
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('rejecting runs nothing', async () => {
    const before = await asMigrator(
      (m) =>
        m<{ n: number }[]>`select count(*)::int as n from tasks where opportunity_id = ${lead}`,
    );
    const answer = await suggest(lead);
    await expect(
      run(caller, rejectInboxItem, { entityId: 1, itemId: answer.inboxItemId }),
    ).resolves.toMatchObject({ state: 'rejected', edited: false });
    const after = await asMigrator(
      (m) =>
        m<{ n: number }[]>`select count(*)::int as n from tasks where opportunity_id = ${lead}`,
    );
    expect(after[0]?.n).toBe(before[0]?.n);
  });
});

describe('agents.inbox.dismiss and Suggest', () => {
  it('a Suggest item is only dismissed: no one-tap run, and nothing runs', async () => {
    const before = await asMigrator(
      (m) =>
        m<{ n: number }[]>`select count(*)::int as n from tasks where opportunity_id = ${lead}`,
    );
    const answer = await suggestOnly(lead);
    const input = { entityId: 1, itemId: answer.inboxItemId };
    for (const command of [approveInboxItem, rejectInboxItem]) {
      await expect(run(caller, command, input)).rejects.toMatchObject(
        reason('agent_suggestion_only'),
      );
    }
    await expect(
      run(caller, editInboxItem, { ...input, changes: { title: 'Ask again' } }),
    ).rejects.toMatchObject(reason('agent_suggestion_only'));
    await expect(run(caller, dismissInboxItem, input)).resolves.toMatchObject({
      state: 'dismissed',
      edited: false,
    });
    const after = await asMigrator(
      (m) =>
        m<{ n: number }[]>`select count(*)::int as n from tasks where opportunity_id = ${lead}`,
    );
    expect(after[0]?.n).toBe(before[0]?.n);
    const [action] = await asMigrator(
      (m) => m<{ state: string; decided_by: string }[]>`
        select state, decided_by from agent_actions where id = ${answer.actionId}`,
    );
    expect(action).toEqual({ state: 'dismissed', decided_by: caller.id });
  });

  it('a Needs approval item is not dismissed', async () => {
    const answer = await suggest(lead);
    await expect(
      run(caller, dismissInboxItem, { entityId: 1, itemId: answer.inboxItemId }),
    ).rejects.toMatchObject(reason('agent_needs_decision'));
  });

  it('is refused to a role without the inbox, to an agent, to someone it is not for, and in another company', async () => {
    const answer = await suggestOnly(lead);
    const input = { entityId: 1, itemId: answer.inboxItemId };
    const field = await createTestPrincipal('field_engineer', [1]);
    await expect(run(field, dismissInboxItem, input)).rejects.toMatchObject({ code: 'forbidden' });
    const withInbox = principalFor('agent:copilot', [1], {
      permissions: [{ key: 'agents.inbox.act', scope: 'entity' }],
    });
    await expect(run(withInbox, dismissInboxItem, input)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(run(otherCaller, dismissInboxItem, input)).rejects.toMatchObject(
      reason('inbox_item_missing'),
    );
    const elsewhere = await createTestPrincipal('general_manager', [2]);
    await expect(run(elsewhere, dismissInboxItem, input)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('agents.config.set', () => {
  it('an Executive sets an agent’s autonomy and daily cap for a company', async () => {
    await asMigrator(
      (m) => m`delete from agent_configs where agent = 'agent:sizing' and action_type is null
                and entity_id = 2`,
    );
    const dto = (await run(executive, setAgentConfig, {
      agent: 'agent:sizing',
      actionType: null,
      entityId: 2,
      autonomy: 'needs_approval',
      dailySpendCapPaise: 50_000,
    })) as { id: string; dailySpendCapPaise: number };
    madeConfigs.push(dto.id);
    expect(dto).toMatchObject({ autonomy: 'needs_approval', dailySpendCapPaise: 50_000 });
    const again = (await run(executive, setAgentConfig, {
      agent: 'agent:sizing',
      actionType: null,
      entityId: 2,
      autonomy: null,
      dailySpendCapPaise: 20_000,
    })) as { id: string };
    expect(again.id).toBe(dto.id);
  });

  it('changes only the fields given: two Executives’ edits keep each other’s', async () => {
    await asMigrator(
      (m) => m`delete from agent_configs where agent = 'agent:orchestrator' and action_type is null
                and entity_id = 3`,
    );
    const key = { agent: 'agent:orchestrator', actionType: null, entityId: 3 };
    const first = (await run(executive, setAgentConfig, {
      ...key,
      autonomy: 'needs_approval',
    })) as { id: string };
    madeConfigs.push(first.id);
    const second = await run(executive, setAgentConfig, { ...key, dailySpendCapPaise: 30_000 });
    expect(second).toMatchObject({ autonomy: 'needs_approval', dailySpendCapPaise: 30_000 });
    const third = await run(executive, setAgentConfig, { ...key, autonomy: null });
    expect(third).toMatchObject({ autonomy: null, dailySpendCapPaise: 30_000 });
    await expect(run(executive, setAgentConfig, key)).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('is refused to a GM and a caller, and for a company outside the request', async () => {
    const input = {
      agent: 'agent:sizing',
      actionType: null,
      entityId: 1,
      autonomy: 'suggest',
    };
    await expect(run(gm, setAgentConfig, input)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(run(caller, setAgentConfig, input)).rejects.toMatchObject({ code: 'forbidden' });
    const narrowed = principalFor('executive', [1], { id: executive.id });
    await expect(run(narrowed, setAgentConfig, { ...input, entityId: 2 })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(run(narrowed, setAgentConfig, { ...input, entityId: null })).rejects.toMatchObject(
      reason('agents_need_all_companies'),
    );
  });

  it('refuses Automatic in Phase 1, whatever the record', async () => {
    // A fresh company-and-action key nobody else writes, and a record far past the rule's,
    // written as the owner: Automatic is still refused.
    const runId = newId();
    await asMigrator((m) =>
      m.begin(async (tx) => {
        await tx`insert into agent_runs (id, entity_id, agent, principal_id, purpose, action_type, outcome, request_id)
                 values (${runId}, 3, 'agent:copilot', ${copilot(3).id}, 'record', ${TASK}, 'proposed', 'record')`;
        await tx`insert into agent_actions (id, entity_id, run_id, agent, action_type, input_json, autonomy, state, decided_by, decided_at, created_by)
                 select gen_random_uuid(), 3, ${runId}, 'agent:copilot', ${TASK}, '{}'::jsonb,
                        'needs_approval', 'approved', ${executive.id}, now(), ${copilot(3).id}
                   from generate_series(1, 250)`;
      }),
    );
    for (const at of [
      { actionType: TASK, entityId: 3 },
      { actionType: null, entityId: 3 },
      { actionType: TASK, entityId: null },
    ]) {
      await expect(
        run(executive, setAgentConfig, { agent: 'agent:copilot', ...at, autonomy: 'automatic' }),
      ).rejects.toMatchObject(reason('autonomy_automatic_unavailable'));
    }
    const [rows] = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from agent_configs where agent = 'agent:copilot'
           and autonomy = 'automatic'`,
    );
    expect(rows?.n).toBe(0);
  });

  it('refuses an action type the agent does not take', async () => {
    await expect(
      run(executive, setAgentConfig, {
        agent: 'agent:chief',
        actionType: TASK,
        entityId: 1,
        autonomy: 'suggest',
      }),
    ).rejects.toMatchObject(reason('agent_action_unknown'));
  });
});

describe('agents.killswitch.set', () => {
  it('a GM stops an agent in their company and lets it run again', async () => {
    await asMigrator(
      (m) => m`delete from agent_configs where agent = 'agent:orchestrator' and action_type is null
                and entity_id = 1`,
    );
    const off = (await run(gm, setKillSwitch, {
      agent: 'agent:orchestrator',
      entityId: 1,
      enabled: false,
    })) as { id: string; enabled: boolean };
    madeConfigs.push(off.id);
    expect(off.enabled).toBe(false);
    const on = (await run(gm, setKillSwitch, {
      agent: 'agent:orchestrator',
      entityId: 1,
      enabled: true,
    })) as { id: string; enabled: boolean };
    expect(on).toMatchObject({ id: off.id, enabled: true });
    const audited = await asMigrator(
      (m) => m<{ after_json: Record<string, unknown> }[]>`
        select after_json from audit_logs where aggregate_id = ${off.id}
         and command = 'agents.killswitch.set' order by created_at`,
    );
    expect(audited.map((a) => a.after_json)).toEqual([{ enabled: false }, { enabled: true }]);
  });

  it('is refused to a caller, and for a company outside the request or the group from one company', async () => {
    await expect(
      run(caller, setKillSwitch, { agent: null, entityId: 1, enabled: false }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      run(gm, setKillSwitch, { agent: null, entityId: 2, enabled: false }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      run(gm, setKillSwitch, { agent: null, entityId: null, enabled: false }),
    ).rejects.toMatchObject(reason('agents_need_all_companies'));
  });
});
