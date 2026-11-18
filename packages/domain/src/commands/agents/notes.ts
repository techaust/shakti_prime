import {
  COPILOT_ACTION_TYPES,
  CopilotNoteDto,
  DomainError,
  newId,
  RecordCopilotNoteInput,
  type CopilotFacts,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import { AGENT_DEFAULTS } from '../../ai/agent-defaults';
import { loadAgentConfig } from '../../ai/config';
import { copilotTextProblem } from '../../ai/copilot/filter';
import { defineCommand } from '../../command/define-command';
import { isAgent } from '../../command/run-command';
import { maskIdentityNumbers } from '../../privacy/identity-numbers';
import { lockOpportunity, requireEntity } from '../crm/opportunity-shared';

type NoteRow = typeof schema.copilotNotes.$inferSelect;

function toNoteDto(row: NoteRow): CopilotNoteDto {
  return CopilotNoteDto.parse({
    id: row.id,
    entityId: row.entityId,
    opportunityId: row.opportunityId,
    providerCallId: row.providerCallId,
    kind: row.kind,
    body: row.body,
    fields: row.fieldsJson as CopilotFacts,
    suggestedDispositionId: row.suggestedDispositionId,
    agentActionId: row.agentActionId,
    suggestionsShown: row.suggestionsShown,
    createdAt: row.createdAt.toISOString(),
  });
}

/**
 * `agents.note.record` (docs/03-roadmap-appendix/phase2.md §7.3): the Caller Co-pilot records a
 * brief or a call summary on a lead it reads, as its own principal (`agents.note.write`, held by
 * `agent:copilot` alone; the insert policy asks for that role too). The text is checked again as
 * the output filter checks it (no identity number, contact detail, instruction or link, at most
 * 600 characters) and its identity numbers masked before it is stored. A summary is of a provider
 * call of the same lead, once per call, and its outcome one of the group's or the company's in
 * use; the outcome is only pre-selected in the call log, never logged here. A lead gets at most
 * one brief an hour (`AGENT_DEFAULTS.copilot.briefIntervalMinutes`). A summary's suggestions are
 * shown to callers only when its facts' action type is past Shadow (`suggestions_shown`). Nothing
 * else changes: the
 * facts it heard are a suggestion of their own, which a person approves.
 */
export const recordCopilotNote = defineCommand({
  name: 'agents.note.record',
  permission: 'agents.note.write',
  minScope: 'entity',
  input: RecordCopilotNoteInput,
  output: CopilotNoteDto,
  auditFields: ['noteKind'],
  // The note's text is about a customer and never reaches the audit row: which lead, call and kind.
  auditInput: (input) => ({
    opportunityId: input.opportunityId,
    providerCallId: input.providerCallId ?? null,
    kind: input.kind,
  }),
  constraintReasons: { copilot_notes_call_unique: 'copilot_summary_recorded' },
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    if (!isAgent(ctx.principal) || ctx.principal.roleKey !== 'agent:copilot') {
      throw new DomainError('forbidden', 'only the Caller Co-pilot records its notes', {
        reason: 'agent_action_not_open',
      });
    }
    if (copilotTextProblem(input.body) !== undefined) {
      throw new DomainError('validation_failed', 'the note did not pass the output filter', {
        reason: 'copilot_note_refused',
      });
    }
    // The lead, held so two briefs cannot both pass the hour's limit.
    const lead = await lockOpportunity(ctx, input);
    const n = schema.copilotNotes;

    if (input.kind === 'brief') {
      const since = new Date(
        ctx.now.getTime() - AGENT_DEFAULTS.copilot.briefIntervalMinutes * 60_000,
      );
      const [recent] = await ctx.tx
        .select({ id: n.id })
        .from(n)
        .where(and(eq(n.opportunityId, lead.id), eq(n.kind, 'brief'), gt(n.createdAt, since)))
        .orderBy(desc(n.createdAt))
        .limit(1);
      if (recent !== undefined) {
        throw new DomainError('conflict', `lead ${lead.id} had a brief within the hour`, {
          reason: 'copilot_brief_recent',
        });
      }
    }
    if (input.providerCallId !== undefined) {
      const pc = schema.providerCalls;
      const [call] = await ctx.tx
        .select({ id: pc.id })
        .from(pc)
        .where(
          and(
            eq(pc.id, input.providerCallId),
            eq(pc.opportunityId, lead.id),
            eq(pc.entityId, lead.entityId),
          ),
        )
        .limit(1);
      if (call === undefined) {
        throw new DomainError('not_found', `call ${input.providerCallId} is not of this lead`, {
          reason: 'provider_call_missing',
        });
      }
    }
    if (input.suggestedDispositionId !== undefined) {
      const d = schema.callDispositions;
      const [outcome] = await ctx.tx
        .select({ id: d.id })
        .from(d)
        .where(
          and(
            eq(d.id, input.suggestedDispositionId),
            or(isNull(d.entityId), eq(d.entityId, lead.entityId)),
            isNull(d.archivedAt),
          ),
        )
        .limit(1);
      if (outcome === undefined) {
        throw new DomainError(
          'not_found',
          `outcome ${input.suggestedDispositionId} is not in use`,
          {
            reason: 'disposition_missing',
          },
        );
      }
    }

    // A summary's suggestions are shown to callers only past Shadow, as its facts' action type
    // stands now: in Shadow the caller sees its text alone (the lead's decision of 18-11-2026).
    let suggestionsShown = false;
    if (input.kind === 'call_summary') {
      const config = await loadAgentConfig(
        ctx.tx,
        'agent:copilot',
        COPILOT_ACTION_TYPES.qualification,
        lead.entityId,
      );
      suggestionsShown = config.enabled && config.autonomy !== 'shadow';
    }

    const id = newId();
    const [row] = await ctx.tx
      .insert(n)
      .values({
        id,
        entityId: lead.entityId,
        opportunityId: lead.id,
        providerCallId: input.providerCallId ?? null,
        kind: input.kind,
        body: maskIdentityNumbers(input.body).text,
        fieldsJson: input.fields,
        suggestedDispositionId: input.suggestedDispositionId ?? null,
        agentActionId: input.agentActionId ?? null,
        suggestionsShown,
        createdAt: ctx.now,
        createdBy: ctx.principal.id,
      })
      .returning();
    if (!row) throw new DomainError('internal', 'copilot note insert returned no row');
    ctx.audit({
      aggregateType: 'copilot_note',
      aggregateId: id,
      entityId: lead.entityId,
      after: { noteKind: input.kind },
    });
    return toNoteDto(row);
  },
});
