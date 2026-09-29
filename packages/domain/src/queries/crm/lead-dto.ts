import { LeadDto, ScoreReasonSchema, type ScoreReason } from '@shakti/contracts';
import type { schema } from '@shakti/db';

type OpportunityRow = typeof schema.opportunities.$inferSelect;
type AccountRow = Pick<typeof schema.accounts.$inferSelect, 'id' | 'type' | 'name'>;
type ContactRow = Pick<typeof schema.contacts.$inferSelect, 'id' | 'name'>;

const Reasons = ScoreReasonSchema.array();

/** The stored reasons of a score; a list that cannot be read shows none. */
function scoreReasons(value: unknown): ScoreReason[] {
  const parsed = Reasons.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/** Whitelists what leaves the command layer for a lead (AGENTS.md §5). */
export function toLeadDto(
  opportunity: OpportunityRow,
  account: AccountRow,
  contact: ContactRow | null,
  phone: string | null,
): LeadDto {
  return LeadDto.parse({
    id: opportunity.id,
    entityId: opportunity.entityId,
    pipelineId: opportunity.pipelineId,
    stageId: opportunity.stageId,
    state: opportunity.state,
    score: opportunity.score,
    scoreReasons: scoreReasons(opportunity.scoreReasonsJson),
    scoreChangedAt: opportunity.scoreChangedAt?.toISOString() ?? null,
    ownerId: opportunity.ownerId,
    teamId: opportunity.teamId,
    siteId: opportunity.siteId,
    account: { id: account.id, type: account.type, name: account.name },
    contact: contact === null ? null : { id: contact.id, name: contact.name, phone },
    updatedAt: opportunity.updatedAt.toISOString(),
  });
}
