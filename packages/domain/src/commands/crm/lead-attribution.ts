import { DomainError, type CreateLeadInput } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { eq, inArray } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { loadScoreFacts, loadScoreRules, rescore, writeScores } from '../../crm/lead-scoring';
import { partnerForCode } from './referrals';

/**
 * What lead creation does for pipelines set-up (docs/03-roadmap-appendix/phase1.md §6.6): a referral code
 * credits the lead to its partner, or refuses the lead (CRM-09), and the lead is scored with the
 * rules that apply to it (CRM-06). `crm.lead.create` calls it once, after the opportunity is
 * written and in the same transaction, so a refused code rolls the whole lead back. It writes no
 * audit row of its own: the lead's creation row records the fields it returns (`referralPartnerId`,
 * `score`). The import batch's set-based path scores its leads with `scoreLeads()` and sends a row
 * with a referral code through `crm.lead.create`.
 */

type OpportunityRow = typeof schema.opportunities.$inferSelect;

export type LeadAttribution = Pick<
  OpportunityRow,
  'referralPartnerId' | 'score' | 'scoreReasonsJson' | 'scoreChangedAt' | 'scoreChangedBy'
>;

export async function applyLeadAttribution(
  ctx: CommandContext,
  args: {
    opportunityId: string;
    entityId: number;
    input: Pick<CreateLeadInput, 'referralCode'>;
  },
): Promise<Partial<LeadAttribution>> {
  const o = schema.opportunities;
  const patch: Partial<LeadAttribution> = {};

  if (args.input.referralCode !== undefined) {
    const partner = await partnerForCode(ctx.tx, args.input.referralCode, args.entityId);
    if (partner === undefined) throw referralCodeUnknown();
    const [row] = await ctx.tx
      .update(o)
      .set({ referralPartnerId: partner })
      .where(eq(o.id, args.opportunityId))
      .returning({ id: o.id });
    if (!row) throw new DomainError('internal', `lead ${args.opportunityId} is not writable`);
    patch.referralPartnerId = partner;
  }

  const scored = await scoreLeads(ctx, [args.opportunityId], [args.entityId]);
  const own = scored.get(args.opportunityId);
  if (own) {
    patch.score = own.score;
    patch.scoreReasonsJson = own.reasons;
    patch.scoreChangedAt = ctx.now;
    patch.scoreChangedBy = ctx.principal.id;
  }
  return patch;
}

/**
 * Scores new leads with the rules of their companies, writing only those whose score differs
 * from the base. Answers the new score and reasons of each lead it wrote. An import batch calls
 * it once for the leads it inserted.
 */
export async function scoreLeads(
  ctx: CommandContext,
  opportunityIds: readonly string[],
  entityIds: readonly number[],
): Promise<Map<string, { score: number; reasons: unknown[] }>> {
  const out = new Map<string, { score: number; reasons: unknown[] }>();
  if (opportunityIds.length === 0) return out;
  const rules = await loadScoreRules(ctx, entityIds);
  // No rule, no change: every lead keeps the base score it was written with.
  if (rules.length === 0) return out;
  const o = schema.opportunities;
  const leads = await loadScoreFacts(
    ctx,
    inArray(o.id, [...opportunityIds]),
    opportunityIds.length,
  );
  const changes = rescore(leads, rules, ctx.now);
  const written = await writeScores(ctx, changes);
  if (written !== changes.length) {
    throw new DomainError('internal', 'a new lead could not be scored');
  }
  for (const c of changes) out.set(c.id, { score: c.next.score, reasons: c.next.reasons });
  return out;
}

/** The refusal of a referral code no active partner of the lead's company has (CRM-09). */
export function referralCodeUnknown(): DomainError {
  return new DomainError('validation_failed', 'no active partner of this company has this code', {
    reason: 'referral_code_unknown',
    // So a form shows the sentence under its referral code box.
    issues: [{ path: 'referralCode', message: 'referral_code_unknown' }],
  });
}
