import {
  AgentConfigDto,
  DomainError,
  newId,
  SetAgentConfigInput,
  SetKillSwitchInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { actionTypeOf, automaticEarned } from '../../ai/action-types';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { moneyFromPaise } from '../../money/paise';
import { requireEntity } from '../crm/opportunity-shared';

/** A cap as the Activity log shows it: rupees, or nothing for no cap. */
const capInRupees = (paise: number | null): string | null =>
  paise === null ? null : moneyFromPaise(BigInt(paise));

type ConfigRow = typeof schema.agentConfigs.$inferSelect;

function toDto(row: ConfigRow): AgentConfigDto {
  return AgentConfigDto.parse({
    id: row.id,
    agent: row.agent,
    actionType: row.actionType,
    entityId: row.entityId,
    autonomy: row.autonomy,
    dailySpendCapPaise: row.dailySpendCapPaise,
    enabled: row.enabled,
  });
}

/**
 * A setting for the whole group needs a request for every active company, as the group's price
 * lists and GST rates do (ADR 0016); a company's setting needs that company in the request.
 */
async function assertScope(ctx: CommandContext, entityId: number | null): Promise<void> {
  if (entityId !== null) {
    requireEntity(ctx, entityId);
    return;
  }
  const covered = (await ctx.tx.execute(
    sql`select app.request_covers_group() as ok`,
  )) as unknown as { ok: boolean }[];
  if (covered[0]?.ok !== true) {
    throw new DomainError('forbidden', 'a setting for every company needs every company', {
      reason: 'agents_need_all_companies',
    });
  }
}

const isNullOr = (column: Parameters<typeof eq>[0], value: string | number | null): SQL =>
  value === null ? isNull(column) : eq(column, value);

/** The row for one agent (or every agent), action type (or every one) and company (or group). */
async function lockRow(
  ctx: CommandContext,
  key: { agent: string | null; actionType: string | null; entityId: number | null },
): Promise<ConfigRow | undefined> {
  const c = schema.agentConfigs;
  const [row] = await ctx.tx
    .select()
    .from(c)
    .where(
      and(
        isNullOr(c.agent, key.agent),
        isNullOr(c.actionType, key.actionType),
        isNullOr(c.entityId, key.entityId),
      ),
    )
    .limit(1)
    .for('update');
  return row;
}

/** The row with `changes`, made when there was none; the unique index settles a race. */
async function upsert(
  ctx: CommandContext,
  key: { agent: string | null; actionType: string | null; entityId: number | null },
  changes: Partial<Pick<ConfigRow, 'autonomy' | 'dailySpendCapPaise' | 'enabled'>>,
): Promise<{ before: ConfigRow | undefined; after: ConfigRow }> {
  const before = await lockRow(ctx, key);
  const c = schema.agentConfigs;
  const [after] =
    before === undefined
      ? await ctx.tx
          .insert(c)
          .values({ id: newId(), ...key, ...changes, createdBy: ctx.principal.id })
          .returning()
      : await ctx.tx
          .update(c)
          .set({ ...changes, updatedBy: ctx.principal.id })
          .where(eq(c.id, before.id))
          .returning();
  if (!after) throw new DomainError('internal', 'agent setting write returned no row');
  return { before, after };
}

/**
 * The record behind Automatic: of the action type's decided suggestions in the companies the
 * setting covers, how many were approved without an edit (BLUEPRINT §9.3, PRD AI-04).
 */
async function decisionRecord(
  ctx: CommandContext,
  agent: string,
  actionType: string,
  entityId: number | null,
): Promise<{ decided: number; approvedUnedited: number }> {
  const a = schema.agentActions;
  const [row] = await ctx.tx
    .select({
      decided: sql<number>`count(*) filter (where ${a.state} in ('approved', 'rejected'))::int`,
      approvedUnedited: sql<number>`count(*) filter (where ${a.state} = 'approved' and not ${a.edited})::int`,
    })
    .from(a)
    .where(
      and(
        eq(a.agent, agent),
        eq(a.actionType, actionType),
        entityId === null ? undefined : eq(a.entityId, entityId),
      ),
    );
  return { decided: row?.decided ?? 0, approvedUnedited: row?.approvedUnedited ?? 0 };
}

/**
 * `agents.config.set` (`agents.autonomy.write`): an agent's autonomy, for every action type or
 * one, and its daily spend cap in paise, for one company or the group. Automatic is set only on
 * one action type, and only once its record allows it: at least 200 decided suggestions, 95% of
 * them approved without an edit; the Executive's change is the sign-off (BLUEPRINT §9.3).
 */
export const setAgentConfig = defineCommand({
  name: 'agents.config.set',
  permission: 'agents.autonomy.write',
  minScope: 'all',
  peopleOnly: true,
  input: SetAgentConfigInput,
  output: AgentConfigDto,
  constraintReasons: { agent_configs_cap_per_agent_check: 'spend_cap_per_agent' },
  auditFields: ['autonomy', 'dailySpendCap'],
  async handler(ctx, input) {
    await assertScope(ctx, input.entityId);
    if (input.actionType !== null) {
      const type = actionTypeOf(input.actionType);
      if (!type.agents.includes(input.agent)) {
        throw new DomainError('validation_failed', `${input.agent} does not take this action`, {
          reason: 'agent_action_unknown',
        });
      }
    }
    if (input.autonomy === 'automatic') {
      const record =
        input.actionType === null
          ? { decided: 0, approvedUnedited: 0 }
          : await decisionRecord(ctx, input.agent, input.actionType, input.entityId);
      if (!automaticEarned(record.decided, record.approvedUnedited)) {
        throw new DomainError('conflict', 'Automatic is not earned yet', {
          reason: 'autonomy_not_earned',
        });
      }
    }
    const key = { agent: input.agent, actionType: input.actionType, entityId: input.entityId };
    const { before, after } = await upsert(ctx, key, {
      autonomy: input.autonomy,
      dailySpendCapPaise: input.dailySpendCapPaise,
    });
    ctx.audit({
      aggregateType: 'agent_config',
      aggregateId: after.id,
      entityId: after.entityId,
      before:
        before === undefined
          ? null
          : {
              autonomy: before.autonomy,
              dailySpendCap: capInRupees(before.dailySpendCapPaise),
            },
      after: { autonomy: after.autonomy, dailySpendCap: capInRupees(after.dailySpendCapPaise) },
    });
    return toDto(after);
  },
});

/**
 * `agents.killswitch.set` (`agents.killswitch`): stops every agent or one, in every company or one,
 * from its next action on, or lets it run again. A switch off at any level stops the agent there
 * (PRD AI-04); suggestions already in an inbox wait and cannot be approved while it is off.
 */
export const setKillSwitch = defineCommand({
  name: 'agents.killswitch.set',
  permission: 'agents.killswitch',
  minScope: 'all',
  peopleOnly: true,
  input: SetKillSwitchInput,
  output: AgentConfigDto,
  auditFields: ['enabled'],
  async handler(ctx, input) {
    await assertScope(ctx, input.entityId);
    const key = { agent: input.agent, actionType: null, entityId: input.entityId };
    const { before, after } = await upsert(ctx, key, { enabled: input.enabled });
    ctx.audit({
      aggregateType: 'agent_config',
      aggregateId: after.id,
      entityId: after.entityId,
      before: before === undefined ? null : { enabled: before.enabled },
      after: { enabled: after.enabled },
    });
    return toDto(after);
  },
});
