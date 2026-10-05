import { type Principal } from '@shakti/contracts';
import {
  AGENT_PRINCIPAL_SEED,
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  createTestUser,
  principalFor,
  stageId,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { assignOpportunity } from '../../src/commands/crm/assign-opportunity';
import { createLead } from '../../src/commands/crm/create-lead';
import { loseOpportunity } from '../../src/commands/crm/lose-opportunity';
import { moveOpportunityStage } from '../../src/commands/crm/move-opportunity-stage';
import { nurtureOpportunity } from '../../src/commands/crm/nurture-opportunity';
import { reopenOpportunity } from '../../src/commands/crm/reopen-opportunity';
import { winOpportunity } from '../../src/commands/crm/win-opportunity';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';

// Every lead command writes its row of the customer timeline in its own transaction, as the
// caller (ctx.activity, docs/ARCHITECTURE.md §5); a refused command writes none.

afterAll(closeDb);

let teamId: string;
let gm: Principal;
let converter: string;

beforeAll(async () => {
  teamId = await createTestTeam(1, 'timeline team');
  gm = await createTestPrincipal('general_manager', [1], { teamId });
  converter = (await createTestUser([{ entityId: 1, roleKey: 'tele_caller_lc', teamId }])).id;
});

function run(principal: Principal, command: AnyCommand, input: unknown): Promise<unknown> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  );
}

const phone = (): string => `97${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

interface ActivityRow {
  type: string;
  opportunity_id: string | null;
  account_id: string;
  entity_id: number;
  actor_principal_id: string;
  payload_json: Record<string, unknown>;
  body: string | null;
}

/** The customer's timeline rows, oldest first, read past the policies. */
async function timelineOf(accountId: string): Promise<ActivityRow[]> {
  return asMigrator(
    (m) => m<ActivityRow[]>`
      select type, opportunity_id, account_id, entity_id, actor_principal_id, payload_json, body
        from activities where account_id = ${accountId} order by created_at, id`,
  );
}

async function newLead(consent = false): Promise<{ id: string; accountId: string }> {
  const lead = (await run(gm, createLead, {
    entityId: 1,
    pipelineKey: 'farmer_pumps',
    contact: { name: 'Timeline customer', phone: phone() },
    account: { type: 'farm' },
    sourceCode: 'walk_in',
    ...(consent
      ? {
          consent: {
            channel: 'call',
            purpose: 'service',
            source: 'walk_in_form',
            textVersion: 'v1',
          },
        }
      : {}),
  })) as { id: string; account: { id: string } };
  return { id: lead.id, accountId: lead.account.id };
}

describe('the timeline rows of the lead commands', () => {
  it('crm.lead.create writes lead_created, and consent_recorded for the customer', async () => {
    const lead = await newLead(true);
    expect(await timelineOf(lead.accountId)).toEqual([
      {
        type: 'lead_created',
        opportunity_id: lead.id,
        account_id: lead.accountId,
        entity_id: 1,
        actor_principal_id: gm.id,
        payload_json: {
          pipelineKey: 'farmer_pumps',
          sourceCode: 'walk_in',
          existingAccount: false,
        },
        body: null,
      },
      {
        type: 'consent_recorded',
        opportunity_id: null,
        account_id: lead.accountId,
        entity_id: 1,
        actor_principal_id: gm.id,
        payload_json: {
          channel: 'call',
          purpose: 'service',
          source: 'walk_in_form',
        },
        body: null,
      },
    ]);
  });

  it('each opportunity command writes its row with ids and codes only', async () => {
    const lead = await newLead();
    const ref = { entityId: 1, opportunityId: lead.id };
    await run(gm, moveOpportunityStage, { ...ref, stageId: stageId(1, 2) });
    await run(gm, assignOpportunity, { ...ref, ownerId: converter });
    await run(gm, nurtureOpportunity, { ...ref, reasonCode: 'waiting_for_funds' });
    await run(gm, reopenOpportunity, ref);
    await run(gm, loseOpportunity, { ...ref, reasonCode: 'no_budget' });

    const rows = await timelineOf(lead.accountId);
    expect(rows.map((r) => r.type)).toEqual([
      'lead_created',
      'stage_moved',
      'assigned',
      'nurtured',
      // The nurture calls on day 7, 30 and 90 (CALL-5).
      'task_created',
      'task_created',
      'task_created',
      'reopened',
      'lost',
    ]);
    expect(rows.every((r) => r.opportunity_id === lead.id && r.actor_principal_id === gm.id)).toBe(
      true,
    );
    expect(rows[1]?.payload_json).toEqual({
      fromStageId: stageId(1, 1),
      toStageId: stageId(1, 2),
      toStageKey: expect.any(String) as unknown,
    });
    expect(rows[2]?.payload_json).toEqual({ fromOwnerId: gm.id, ownerId: converter, teamId });
    expect(rows[3]?.payload_json).toEqual({ reasonCode: 'waiting_for_funds' });
    expect(rows[8]?.payload_json).toMatchObject({ reasonCode: 'no_budget' });
  });

  it('a refused command writes no row', async () => {
    const lead = await newLead();
    // No lead can be won before quotes exist, so the command is refused and rolls back.
    await expect(
      run(gm, winOpportunity, { entityId: 1, opportunityId: lead.id }),
    ).rejects.toMatchObject({ details: { reason: 'win_needs_order' } });
    expect((await timelineOf(lead.accountId)).map((r) => r.type)).toEqual(['lead_created']);
  });

  it('an agent’s change is recorded as the agent’s own', async () => {
    const lead = await newLead();
    const seed = AGENT_PRINCIPAL_SEED.find((a) => a.roleKey === 'agent:triage');
    const triage = principalFor('agent:triage', [1], { id: seed?.id ?? '' });
    await run(triage, moveOpportunityStage, {
      entityId: 1,
      opportunityId: lead.id,
      stageId: stageId(1, 2),
    });
    const rows = await timelineOf(lead.accountId);
    expect(rows.at(-1)).toMatchObject({ type: 'stage_moved', actor_principal_id: seed?.id });
  });
});
