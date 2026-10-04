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
import { approveInboxItem, editInboxItem, rejectInboxItem } from '../../src/commands/agents/inbox';
import { recordAgentRun } from '../../src/commands/agents/record-run';
import { createLead } from '../../src/commands/crm/create-lead';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';

// agents.run.record, agents.inbox.approve, .edit and .reject, agents.config.set and
// agents.killswitch.set (docs/design/phase1.md §7.1): an agent records its runs and files
// suggestions as itself; a person approves one, and the command runs as that person; the agent
// controls set autonomy, caps and kill switches. Each test uses its own company's settings and
// removes them, so no other suite finds an agent stopped.

const HOUR = 3_600_000;
const later = (hours = 24): string => new Date(Date.now() + hours * HOUR).toISOString();
const reason = (r: string) => ({ details: { reason: r } });

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

/** A setting written as the owner, so a test can set Automatic without its record. */
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
  await asMigrator(
    (m) => m`insert into agent_configs (id, agent, action_type, entity_id, autonomy, daily_spend_cap_paise, enabled, created_by)
             values (${id}, ${row.agent === undefined ? 'agent:copilot' : row.agent}, ${row.actionType ?? null},
                     ${row.entityId}, ${row.autonomy ?? null}, ${row.cap ?? null}, ${row.enabled ?? true},
                     ${executive.id})`,
  );
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
    actionType: 'crm.task.create',
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
            teamId,
          },
        }),
    ...extra,
  };
}

async function suggest(opportunityId: string): Promise<RunAnswer> {
  return (await run(copilot(), recordAgentRun, runInput(1, opportunityId))) as RunAnswer;
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
    expect(item).toEqual({ state: 'open', assignee_id: caller.id, agent_action_id: answer.actionId });
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

  it('is refused for another company, and for a proposal outside its run', async () => {
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

  it('acts at once when the action type is Automatic: the task is made as the agent', async () => {
    const automatic = await setting({
      entityId: 1,
      actionType: 'crm.task.create',
      autonomy: 'automatic',
    });
    try {
      const answer = await suggest(lead);
      expect(answer).toMatchObject({ outcome: 'acted', inboxItemId: null });
      const [task] = await asMigrator(
        (m) => m<{ created_by: string }[]>`
          select created_by from tasks where opportunity_id = ${lead} order by created_at desc limit 1`,
      );
      expect(task?.created_by).toBe(copilot().id);
      const [action] = await asMigrator(
        (m) => m<{ state: string }[]>`select state from agent_actions where id = ${answer.actionId}`,
      );
      expect(action?.state).toBe('executed');
    } finally {
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

  it('rejecting runs nothing', async () => {
    const before = await asMigrator(
      (m) => m<{ n: number }[]>`select count(*)::int as n from tasks where opportunity_id = ${lead}`,
    );
    const answer = await suggest(lead);
    await expect(
      run(caller, rejectInboxItem, { entityId: 1, itemId: answer.inboxItemId }),
    ).resolves.toMatchObject({ state: 'rejected', edited: false });
    const after = await asMigrator(
      (m) => m<{ n: number }[]>`select count(*)::int as n from tasks where opportunity_id = ${lead}`,
    );
    expect(after[0]?.n).toBe(before[0]?.n);
  });
});

describe('agents.config.set', () => {
  it('an Executive sets an agent’s autonomy and daily cap for a company', async () => {
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

  it('is refused to a GM and a caller, and for a company outside the request', async () => {
    const input = {
      agent: 'agent:sizing',
      actionType: null,
      entityId: 1,
      autonomy: 'suggest',
      dailySpendCapPaise: null,
    };
    await expect(run(gm, setAgentConfig, input)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(run(caller, setAgentConfig, input)).rejects.toMatchObject({ code: 'forbidden' });
    const narrowed = principalFor('executive', [1], { id: executive.id });
    await expect(
      run(narrowed, setAgentConfig, { ...input, entityId: 2 }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      run(narrowed, setAgentConfig, { ...input, entityId: null }),
    ).rejects.toMatchObject(reason('agents_need_all_companies'));
  });

  it('allows Automatic only on one action type with 200 decisions, 95% approved unedited', async () => {
    const input = {
      agent: 'agent:copilot',
      actionType: 'crm.task.create',
      entityId: 3,
      autonomy: 'automatic',
      dailySpendCapPaise: null,
    };
    await expect(
      run(executive, setAgentConfig, { ...input, actionType: null }),
    ).rejects.toMatchObject(reason('autonomy_not_earned'));
    const [record] = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*) filter (where state = 'approved' and not edited)::int as n
          from agent_actions where agent = 'agent:copilot' and action_type = 'crm.task.create'
           and entity_id = 3`,
    );
    if ((record?.n ?? 0) < 200) {
      await expect(run(executive, setAgentConfig, input)).rejects.toMatchObject(
        reason('autonomy_not_earned'),
      );
      // The record, written as the owner: 200 suggestions approved as they were.
      await asMigrator((m) =>
        m.begin(async (tx) => {
          const runId = newId();
          await tx`insert into agent_runs (id, entity_id, agent, principal_id, purpose, action_type, outcome, request_id)
                   values (${runId}, 3, 'agent:copilot', ${copilot(3).id}, 'record', 'crm.task.create', 'proposed', 'record')`;
          await tx`insert into agent_actions (id, entity_id, run_id, agent, action_type, input_json, autonomy, state, decided_by, decided_at, created_by)
                   select gen_random_uuid(), 3, ${runId}, 'agent:copilot', 'crm.task.create', '{}'::jsonb,
                          'needs_approval', 'approved', ${executive.id}, now(), ${copilot(3).id}
                     from generate_series(1, 200)`;
        }),
      );
    }
    const dto = (await run(executive, setAgentConfig, input)) as { id: string; autonomy: string };
    madeConfigs.push(dto.id);
    expect(dto.autonomy).toBe('automatic');
  });

  it('refuses an action type the agent does not take', async () => {
    await expect(
      run(executive, setAgentConfig, {
        agent: 'agent:chief',
        actionType: 'crm.task.create',
        entityId: 1,
        autonomy: 'suggest',
        dailySpendCapPaise: null,
      }),
    ).rejects.toMatchObject(reason('agent_action_unknown'));
  });
});

describe('agents.killswitch.set', () => {
  it('a GM stops an agent in their company and lets it run again', async () => {
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
