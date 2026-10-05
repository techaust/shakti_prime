import { newId, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  principalFor,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentPrincipal } from '../../src/ai/runtime';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { recordAgentRun } from '../../src/commands/agents/record-run';
import { createLead } from '../../src/commands/crm/create-lead';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { countInbox, listInbox } from '../../src/queries/agents/inbox';
import { loadAgentSettings } from '../../src/queries/agents/settings';

// The Agent Inbox and the agents screen's reads (docs/design/phase1.md §7.1), on company 2. Each
// test writes its own settings, replacing any row a run left with the same key, and removes them.

const ENTITY = 2;
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

/** A setting for the Caller Co-pilot written as the owner, replacing any row with its key. */
async function setting(row: {
  actionType?: string | null;
  entityId: number | null;
  autonomy?: string | null;
  cap?: number | null;
  enabled?: boolean;
}): Promise<string> {
  const id = newId();
  madeConfigs.push(id);
  await asMigrator(async (m) => {
    await m`delete from agent_configs where agent = 'agent:copilot'
                     and action_type is not distinct from ${row.actionType ?? null} and entity_id is not distinct from ${row.entityId}`;
    await m`insert into agent_configs (id, agent, action_type, entity_id, autonomy, daily_spend_cap_paise, enabled, created_by)
             values (${id}, 'agent:copilot', ${row.actionType ?? null}, ${row.entityId}, ${row.autonomy ?? null},
                     ${row.cap ?? null}, ${row.enabled ?? true}, ${gm.id})`;
  });
  return id;
}

const drop = (id: string) => asMigrator((m) => m`delete from agent_configs where id = ${id}`);

let team: string;
let caller: Principal;
let otherCaller: Principal;
let gm: Principal;
let lead: string;

async function suggestFor(assignee: Principal, costPaise = 0): Promise<string> {
  const answer = (await run(agentPrincipal('agent:copilot', ENTITY), recordAgentRun, {
    entityId: ENTITY,
    agent: 'agent:copilot',
    purpose: 'follow_up',
    actionType: 'crm.task.create',
    model: null,
    tokensIn: 0,
    tokensOut: 0,
    costPaise,
    durationMs: 1,
    ended: 'completed',
    proposal: {
      input: {
        entityId: ENTITY,
        opportunityId: lead,
        kind: 'follow_up',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
      subjectType: 'opportunity',
      subjectId: lead,
      assigneeId: assignee.id,
      teamId: team,
    },
  })) as { inboxItemId: string };
  return answer.inboxItemId;
}

const inbox = (who: Principal, input: object = { limit: 50 }) =>
  asPrincipal(who, (ctx) => listInbox(ctx, input));

beforeAll(async () => {
  team = await createTestTeam(ENTITY, 'inbox list team');
  caller = await createTestPrincipal('tele_caller_cc', [ENTITY], { teamId: team });
  otherCaller = await createTestPrincipal('tele_caller_cc', [ENTITY], { teamId: team });
  gm = await createTestPrincipal('general_manager', [ENTITY]);
  const made = (await run(gm, createLead, {
    entityId: ENTITY,
    pipelineKey: 'farmer_pumps',
    contact: {
      name: 'Inbox list customer',
      phone: `93${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
    },
    account: { type: 'farm', name: 'Inbox list farm' },
  })) as { id: string };
  lead = made.id;
  // The Caller Co-pilot's own row here says nothing, whatever the journeys' seed left: Suggest.
  await setting({ entityId: ENTITY });
  await setting({ entityId: ENTITY, actionType: 'crm.task.create' });
});

describe('listInbox and countInbox', () => {
  it('lists the caller’s own open suggestions, newest first, a page at a time', async () => {
    const first = await suggestFor(caller);
    const second = await suggestFor(caller);
    const third = await suggestFor(caller);
    const page = await inbox(caller, { limit: 2 });
    expect(page.items.map((i) => i.id)).toEqual([third, second]);
    // Under Suggest the card shows what the task would be; the screen offers no edit.
    expect(page.items[0]).toMatchObject({
      agent: 'agent:copilot',
      actionType: 'crm.task.create',
      autonomy: 'suggest',
      subjectId: lead,
      assigneeId: caller.id,
      summary: [
        { name: 'assigneeId', kind: 'person', value: caller.id, label: 'test tele_caller_cc' },
        { name: 'kind', kind: 'code', value: 'follow_up', label: null },
      ],
      fields: [
        { name: 'dueAt', kind: 'date_time' },
        { name: 'title', kind: 'text', value: null, maxLength: 80 },
      ],
    });
    expect(page.nextCursor).not.toBeNull();
    const next = await inbox(caller, { limit: 2, cursor: page.nextCursor });
    expect(next.items.map((i) => i.id)).toContain(first);
    expect((await asPrincipal(caller, (ctx) => countInbox(ctx))).open).toBeGreaterThanOrEqual(3);
  });

  it('shows the fields a person may change under Needs approval', async () => {
    const mode = await setting({
      entityId: ENTITY,
      actionType: 'crm.task.create',
      autonomy: 'needs_approval',
    });
    try {
      const id = await suggestFor(caller);
      const item = (await inbox(caller)).items.find((i) => i.id === id);
      expect(item).toMatchObject({
        autonomy: 'needs_approval',
        fields: [
          { name: 'dueAt', kind: 'date_time' },
          { name: 'title', kind: 'text', value: null, maxLength: 80 },
        ],
      });
    } finally {
      await drop(mode);
    }
  });

  it('never shows another caller’s item; the company’s items show at company scope only', async () => {
    const mine = await suggestFor(caller);
    const other = (await inbox(otherCaller)).items.map((i) => i.id);
    expect(other).not.toContain(mine);
    const all = (await inbox(gm)).items.map((i) => i.id);
    expect(all).toContain(mine);
    expect(
      (await inbox(principalFor('general_manager', [1]))).items.map((i) => i.id),
    ).not.toContain(mine);
  });

  it('shows the customer’s name to whoever reads the lead', async () => {
    const id = await suggestFor(caller);
    const item = (await inbox(gm)).items.find((i) => i.id === id);
    expect(item?.subjectName).toBe('Inbox list farm');
  });

  it('is refused to a role without the inbox and to an agent', async () => {
    const field = principalFor('field_engineer', [ENTITY]);
    await expect(inbox(field)).rejects.toMatchObject({ code: 'forbidden' });
    const agent = principalFor('agent:copilot', [ENTITY], {
      permissions: [{ key: 'agents.inbox.act', scope: 'entity' }],
    });
    await expect(inbox(agent)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(asPrincipal(agent, (ctx) => countInbox(ctx))).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('refuses a cursor it did not make', async () => {
    await expect(inbox(caller, { limit: 2, cursor: 'bm8' })).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });
});

describe('loadAgentSettings', () => {
  it('shows each agent’s switch, autonomy, caps and spend today at the company, and where each comes from', async () => {
    const company = await setting({
      entityId: ENTITY,
      autonomy: 'needs_approval',
      cap: 9000,
      enabled: false,
    });
    const group = await setting({ entityId: null, autonomy: 'suggest', cap: 50_000 });
    try {
      await suggestFor(caller, 40);
      const settings = await asPrincipal(gm, (ctx) => loadAgentSettings(ctx));
      expect(settings).toMatchObject({ entityId: ENTITY, automaticAvailable: false });
      const copilot = settings.agents.find((a) => a.agent === 'agent:copilot');
      expect(copilot).toMatchObject({
        enabled: false,
        stopped: true,
        autonomy: 'needs_approval',
        effective: { autonomy: 'needs_approval', source: 'agent_company' },
        // The empty choice would take the group's setting.
        inherited: { autonomy: 'suggest', source: 'agent_group' },
        dailySpendCapPaise: 9000,
        groupCapPaise: 50_000,
      });
      expect(copilot?.spentTodayPaise).toBeGreaterThanOrEqual(40);
      expect(copilot?.actionTypes).toEqual([
        expect.objectContaining({
          actionType: 'crm.task.create',
          autonomy: null,
          effective: { autonomy: 'needs_approval', source: 'agent_company' },
          inherited: { autonomy: 'needs_approval', source: 'agent_company' },
        }),
      ]);
      expect(settings.agents.find((a) => a.agent === 'agent:chief')).toMatchObject({
        enabled: true,
        stopped: false,
        effective: { autonomy: 'suggest', source: 'default' },
        groupCapPaise: null,
        actionTypes: [],
      });
    } finally {
      await drop(group);
      await drop(company);
    }
  });

  it('is refused without an agent control', async () => {
    await expect(asPrincipal(caller, (ctx) => loadAgentSettings(ctx))).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});
