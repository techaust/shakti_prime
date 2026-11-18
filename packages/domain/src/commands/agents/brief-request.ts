import { DomainError, RequestCopilotBriefDto, RequestCopilotBriefInput } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { AGENT_DEFAULTS } from '../../ai/agent-defaults';
import { defineCommand } from '../../command/define-command';
import { requireEntity } from '../crm/opportunity-shared';

/**
 * `agents.brief.request` (docs/03-roadmap-appendix/phase2.md §7.3): a person asks the Caller
 * Co-pilot for a brief on an open lead they read, from its panel; the brief worker writes it from
 * `agents.brief.requested`. A lead gets at most one brief an hour
 * (`AGENT_DEFAULTS.copilot.briefIntervalMinutes`), so a lead briefed within the hour is refused
 * here (`copilot_brief_recent`) and again by `agents.note.record`. Nothing else changes; a person
 * asks for it, never an agent.
 */
export const requestCopilotBrief = defineCommand({
  name: 'agents.brief.request',
  permission: 'crm.lead.read',
  minScope: 'own',
  peopleOnly: true,
  input: RequestCopilotBriefInput,
  output: RequestCopilotBriefDto,
  auditFields: ['copilotBriefRequested'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    // The lead as the person reads it: one they cannot read is not found.
    const o = schema.opportunities;
    const [lead] = await ctx.tx
      .select({ id: o.id, entityId: o.entityId, state: o.state })
      .from(o)
      .where(
        and(eq(o.id, input.opportunityId), eq(o.entityId, input.entityId), isNull(o.archivedAt)),
      )
      .limit(1);
    if (lead === undefined) {
      throw new DomainError('not_found', `opportunity ${input.opportunityId} is not visible`, {
        reason: 'lead_missing',
      });
    }
    if (lead.state !== 'open' && lead.state !== 'nurture') {
      throw new DomainError('conflict', `lead ${lead.id} is closed`, {
        reason: 'copilot_lead_closed',
      });
    }
    const n = schema.copilotNotes;
    const since = new Date(
      ctx.now.getTime() - AGENT_DEFAULTS.copilot.briefIntervalMinutes * 60_000,
    );
    const [recent] = await ctx.tx
      .select({ id: n.id })
      .from(n)
      .where(and(eq(n.opportunityId, lead.id), eq(n.kind, 'brief'), gt(n.createdAt, since)))
      .limit(1);
    if (recent !== undefined) {
      throw new DomainError('conflict', `lead ${lead.id} had a brief within the hour`, {
        reason: 'copilot_brief_recent',
      });
    }
    ctx.audit({
      aggregateType: 'opportunity',
      aggregateId: lead.id,
      entityId: lead.entityId,
      after: { copilotBriefRequested: true },
    });
    ctx.emit({
      type: 'agents.brief.requested',
      entityId: lead.entityId,
      aggregateType: 'opportunity',
      aggregateId: lead.id,
      payload: { requestedById: ctx.principal.id },
    });
    return { opportunityId: lead.id, requestedAt: ctx.now.toISOString() };
  },
});
