import { type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  createTestUser,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { createLead } from '../../src/commands/crm/create-lead';
import { cancelTask, completeTask, createTask, rescheduleTask } from '../../src/commands/crm/tasks';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';

// crm.task.create, .complete, .reschedule and .cancel (docs/design/phase1.md §6.5): a task is on a
// lead the caller may work on, for the caller or, with crm.lead.assign at the scope that covers
// them, for an active colleague who works on leads in that company.

afterAll(closeDb);

const HOUR = 3_600_000;
const later = (hours = 24): string => new Date(Date.now() + hours * HOUR).toISOString();

let teamId: string;
let otherTeamId: string;
let caller: Principal;
let colleague: Principal;
let teamLead: Principal;
let gm: Principal;
/** People with users rows, who may be given a task. */
let converter: string;
let otherTeamConverter: string;
let suspended: string;

beforeAll(async () => {
  teamId = await createTestTeam(1, 'task team');
  otherTeamId = await createTestTeam(1, 'task other team');
  const callerUser = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc', teamId }]);
  caller = await createTestPrincipal('tele_caller_cc', [1], { id: callerUser.id, teamId });
  colleague = await createTestPrincipal('tele_caller_cc', [1], { teamId });
  teamLead = await createTestPrincipal('sales_team_lead', [1], { teamId });
  gm = await createTestPrincipal('general_manager', [1]);
  converter = (await createTestUser([{ entityId: 1, roleKey: 'tele_caller_lc', teamId }])).id;
  otherTeamConverter = (
    await createTestUser([{ entityId: 1, roleKey: 'tele_caller_lc', teamId: otherTeamId }])
  ).id;
  suspended = (
    await createTestUser([{ entityId: 1, roleKey: 'tele_caller_lc', teamId }], {
      status: 'suspended',
    })
  ).id;
});

function run(principal: Principal, command: AnyCommand, input: unknown): Promise<unknown> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  );
}

const phone = (): string => `96${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

async function leadOf(owner: Principal, entityId = 1): Promise<string> {
  const lead = (await run(owner, createLead, {
    entityId,
    pipelineKey: 'farmer_pumps',
    contact: { name: 'Task customer', phone: phone() },
    account: { type: 'farm' },
  })) as { id: string };
  return lead.id;
}

interface Task {
  id: string;
  state: string;
  assigneeId: string;
  teamId: string | null;
  dueAt: string;
  doneAt: string | null;
}

async function task(who: Principal, opportunityId: string, extra: object = {}): Promise<Task> {
  return (await run(who, createTask, {
    entityId: 1,
    opportunityId,
    kind: 'callback',
    dueAt: later(),
    ...extra,
  })) as Task;
}

const reason = (r: string) => ({ details: { reason: r } });

describe('crm.task.create', () => {
  it('a caller adds a callback on their own lead, for themselves', async () => {
    const lead = await leadOf(caller);
    const made = await task(caller, lead, { title: 'Ask about the borewell depth' });
    expect(made).toMatchObject({ state: 'open', assigneeId: caller.id, teamId, doneAt: null });
    const [row] = await asMigrator(
      (m) => m<{ type: string; payload_json: Record<string, unknown> }[]>`
        select type, payload_json from activities where opportunity_id = ${lead} and type = 'task_created'`,
    );
    expect(row?.payload_json).toMatchObject({ taskId: made.id, kind: 'callback' });
    const audited = await asMigrator(
      (m) => m<{ after_json: Record<string, unknown> }[]>`
        select after_json from audit_logs where aggregate_id = ${made.id} and command = 'crm.task.create'`,
    );
    expect(audited[0]?.after_json).toMatchObject({ taskKind: 'callback', state: 'open' });
  });

  it('is refused to a role that does not work on leads', async () => {
    const lead = await leadOf(caller);
    const accounts = await createTestPrincipal('accounts', [1]);
    await expect(task(accounts, lead)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('is refused for another company, and for a lead of another company', async () => {
    const lead = await leadOf(gm);
    await expect(
      run(caller, createTask, { entityId: 2, opportunityId: lead, kind: 'review', dueAt: later() }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const everywhere = await createTestPrincipal('general_manager', [1, 2]);
    await expect(
      run(everywhere, createTask, {
        entityId: 2,
        opportunityId: lead,
        kind: 'review',
        dueAt: later(),
      }),
    ).rejects.toMatchObject(reason('lead_missing'));
  });

  it('is refused on a colleague’s lead the caller cannot see', async () => {
    const lead = await leadOf(colleague);
    await expect(task(caller, lead)).rejects.toMatchObject(reason('lead_missing'));
  });

  it('refuses a due time in the past', async () => {
    const lead = await leadOf(caller);
    await expect(task(caller, lead, { dueAt: later(-2) })).rejects.toMatchObject(
      reason('task_due_in_past'),
    );
  });

  it('a caller cannot give a task to someone else', async () => {
    const lead = await leadOf(caller);
    await expect(task(caller, lead, { assigneeId: converter })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('a team lead gives a task to their own team, not to another team', async () => {
    const lead = await leadOf(teamLead);
    const made = await task(teamLead, lead, { assigneeId: converter, kind: 'follow_up' });
    expect(made).toMatchObject({ assigneeId: converter, teamId });
    await expect(task(teamLead, lead, { assigneeId: otherTeamConverter })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('a GM gives a task to anyone active who works on leads in the company', async () => {
    const lead = await leadOf(gm);
    const made = await task(gm, lead, { assigneeId: otherTeamConverter, kind: 'nurture' });
    expect(made).toMatchObject({ assigneeId: otherTeamConverter, teamId: otherTeamId });
    await expect(task(gm, lead, { assigneeId: suspended })).rejects.toMatchObject(
      reason('assignee_not_eligible'),
    );
  });
});

describe('crm.task.complete, .reschedule and .cancel', () => {
  it('the person the task is for completes it, once', async () => {
    const lead = await leadOf(caller);
    const made = await task(caller, lead);
    const done = (await run(caller, completeTask, { entityId: 1, taskId: made.id })) as Task;
    expect(done.state).toBe('done');
    expect(done.doneAt).not.toBeNull();
    await expect(run(caller, completeTask, { entityId: 1, taskId: made.id })).rejects.toMatchObject(
      reason('task_transition_not_allowed'),
    );
    const types = await asMigrator(
      (m) => m<{ type: string }[]>`
        select type from activities where opportunity_id = ${lead} order by created_at, id`,
    );
    expect(types.map((t) => t.type)).toEqual(['lead_created', 'task_created', 'task_done']);
  });

  it('moves an open task to a later time and never into the past', async () => {
    const lead = await leadOf(caller);
    const made = await task(caller, lead);
    const dueAt = later(48);
    const moved = (await run(caller, rescheduleTask, {
      entityId: 1,
      taskId: made.id,
      dueAt,
    })) as Task;
    expect(Date.parse(moved.dueAt)).toBe(Date.parse(dueAt));
    await expect(
      run(caller, rescheduleTask, { entityId: 1, taskId: made.id, dueAt: later(-1) }),
    ).rejects.toMatchObject(reason('task_due_in_past'));
  });

  it('cancels an open task, which then cannot be done', async () => {
    const lead = await leadOf(caller);
    const made = await task(caller, lead);
    const cancelled = (await run(caller, cancelTask, { entityId: 1, taskId: made.id })) as Task;
    expect(cancelled.state).toBe('cancelled');
    await expect(run(caller, completeTask, { entityId: 1, taskId: made.id })).rejects.toMatchObject(
      reason('task_transition_not_allowed'),
    );
  });

  it('a colleague cannot see or change someone else’s task; the team lead can', async () => {
    const lead = await leadOf(caller);
    const made = await task(caller, lead);
    await expect(
      run(colleague, completeTask, { entityId: 1, taskId: made.id }),
    ).rejects.toMatchObject(reason('task_missing'));
    await expect(run(caller, completeTask, { entityId: 2, taskId: made.id })).rejects.toMatchObject(
      { code: 'forbidden' },
    );
    const done = (await run(teamLead, completeTask, { entityId: 1, taskId: made.id })) as Task;
    expect(done.state).toBe('done');
  });
});
