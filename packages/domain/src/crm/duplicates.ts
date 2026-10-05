import {
  DuplicateKindSchema,
  DuplicateReasonSchema,
  type DuplicateKind,
  type DuplicateReason,
  type DuplicateSignal,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import type { CommandContext } from '../command/context';
import { duplicateConfidence } from './duplicate-confidence';

/**
 * Finding and recording duplicate candidates (PRD CRM-03, docs/design/phase1.md §7.4). The
 * database finds the facts (`app.duplicate_facts()`), the confidence is worked out here
 * (`duplicateConfidence()`), and the pairs worth a card are recorded through
 * `app.record_duplicates()`, which checks each pair again before it writes it. Both definers
 * answer ids and yes-or-no facts only. Lead creation looks around the customer it just wrote; the
 * nightly search (`crm.duplicate.scan`) walks a company's customers a batch at a time.
 */

/** How many customers one batch of the nightly search looks around. */
export const DUPLICATE_SCAN_BATCH = 500;

/** A pair worth a card: its kind, the two ids in order, and why. */
export interface FoundPair {
  kind: DuplicateKind;
  firstId: string;
  secondId: string;
  reason: DuplicateReason;
  confidence: number;
  signals: DuplicateSignal[];
}

/** What the search around some customers found, and the last customer it looked around. */
export interface FoundDuplicates {
  pairs: FoundPair[];
  /** How many customers were looked around. */
  subjects: number;
  lastSubjectId: string | null;
}

interface FactRow {
  subject_id: string;
  pair_kind: string | null;
  first_id: string | null;
  second_id: string | null;
  same_phone: boolean;
  same_name: boolean;
  same_village: boolean;
  same_customer: boolean;
}

/**
 * The pairs around one customer the caller may change (`{ accountId }`, lead creation), or around
 * the next `limit` customers of a company after `afterId` (`{ afterId, limit }`, the nightly
 * search, which holds `crm.duplicates.scan`).
 */
export async function findDuplicates(
  ctx: CommandContext,
  entityId: number,
  around: { accountId: string } | { afterId: string | null; limit: number },
): Promise<FoundDuplicates> {
  const account = 'accountId' in around ? around.accountId : null;
  const after = 'accountId' in around ? null : around.afterId;
  const limit = 'accountId' in around ? 1 : around.limit;
  const rows = (await ctx.tx.execute(sql`
    select * from app.duplicate_facts(${entityId}::smallint, ${after}::uuid, ${limit}::int,
                                      ${account}::uuid)`)) as unknown as FactRow[];
  const subjects = new Set<string>();
  let lastSubjectId: string | null = null;
  const pairs = new Map<string, FoundPair>();
  for (const row of rows) {
    subjects.add(row.subject_id);
    if (lastSubjectId === null || row.subject_id > lastSubjectId) lastSubjectId = row.subject_id;
    if (row.pair_kind === null || row.first_id === null || row.second_id === null) continue;
    const kind = DuplicateKindSchema.parse(row.pair_kind);
    const found = duplicateConfidence({
      kind,
      samePhone: row.same_phone,
      sameName: row.same_name,
      sameVillage: row.same_village,
      sameCustomer: row.same_customer,
    });
    if (found === undefined) continue;
    const key = `${kind}:${row.first_id}:${row.second_id}`;
    const seen = pairs.get(key);
    // A pair found from both of its customers in one batch is one card, at its surest.
    if (seen !== undefined && seen.confidence >= found.confidence) continue;
    pairs.set(key, {
      kind,
      firstId: row.first_id,
      secondId: row.second_id,
      reason: found.reason,
      confidence: found.confidence,
      signals: found.signals,
    });
  }
  return { pairs: [...pairs.values()], subjects: subjects.size, lastSubjectId };
}

/** A candidate `app.record_duplicates()` wrote. */
export interface RecordedDuplicate {
  id: string;
  kind: DuplicateKind;
  reason: DuplicateReason;
  confidence: number;
}

/**
 * Records the pairs as open candidates of the company, each checked again by the definer; a pair
 * already recorded there, whatever became of it, is left as it is. Each new candidate sends
 * `crm.duplicate.found`, for the notifications of N1.
 */
export async function recordDuplicates(
  ctx: CommandContext,
  entityId: number,
  pairs: readonly FoundPair[],
): Promise<RecordedDuplicate[]> {
  if (pairs.length === 0) return [];
  const rows = (await ctx.tx.execute(sql`
    select * from app.record_duplicates(${entityId}::smallint, ${JSON.stringify(pairs)}::jsonb)`)) as unknown as {
    candidate_id: string;
    candidate_kind: string;
    candidate_reason: string;
    candidate_confidence: number;
  }[];
  const recorded = rows.map((r) => ({
    id: r.candidate_id,
    kind: DuplicateKindSchema.parse(r.candidate_kind),
    reason: DuplicateReasonSchema.parse(r.candidate_reason),
    confidence: Number(r.candidate_confidence),
  }));
  for (const candidate of recorded) {
    ctx.emit({
      type: 'crm.duplicate.found',
      entityId,
      aggregateType: 'duplicate_candidate',
      aggregateId: candidate.id,
      payload: {
        kind: candidate.kind,
        reason: candidate.reason,
        confidence: candidate.confidence,
      },
    });
  }
  return recorded;
}
