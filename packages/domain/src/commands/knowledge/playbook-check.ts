import {
  DomainError,
  newId,
  PlaybookCheckRecordDto,
  RecordPlaybookCheckInput,
  type PlaybookAudience,
  type PlaybookDirectiveType,
} from '@shakti/contracts';
import type { RequestTx } from '@shakti/db';
import { sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { requireEntity } from '../crm/opportunity-shared';

/** A draft the conflict check is asked to check, as `app.playbook_check_targets()` answers it. */
export interface PlaybookCheckTarget {
  directiveId: string;
  entityId: number | null;
  type: PlaybookDirectiveType;
  audience: PlaybookAudience;
  title: string;
  text: string;
  /** The SHA-256 of its type, audience, title and text, which the record compares under lock. */
  wordingSha256: string;
  /** The embedding it already has (a recheck of the same wording), or undefined. */
  embedding: number[] | undefined;
}

/** An approved directive near a draft, as `app.playbook_check_candidates()` answers it. */
export interface PlaybookCandidate {
  otherId: string;
  title: string;
  text: string;
  distance: number;
}

/** pgvector's text form, `[0.1,0.2,…]`, as numbers. */
function vectorOf(text: string | null): number[] | undefined {
  if (text === null) return undefined;
  return text
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((n) => Number(n));
}

/**
 * The drafts a change of `directiveId` asks the conflict check to check (`knowledge.playbook.check`):
 * the draft itself while unchecked, or the drafts a new approval has made stale. Never a
 * directive's state or anyone's data beyond its wording.
 */
export async function playbookCheckTargets(
  tx: RequestTx,
  directiveId: string,
): Promise<PlaybookCheckTarget[]> {
  const rows = (await tx.execute(
    sql`select directive_id, entity_id, type, audience, title, body, wording_sha256, embedding
          from app.playbook_check_targets(${directiveId}::uuid)`,
  )) as unknown as {
    directive_id: string;
    entity_id: number | null;
    type: PlaybookDirectiveType;
    audience: PlaybookAudience;
    title: string;
    body: string;
    wording_sha256: string;
    embedding: string | null;
  }[];
  return rows.map((r) => ({
    directiveId: r.directive_id,
    entityId: r.entity_id,
    type: r.type,
    audience: r.audience,
    title: r.title,
    text: r.body,
    wordingSha256: r.wording_sha256,
    embedding: vectorOf(r.embedding),
  }));
}

/**
 * A draft's conflict candidates, nearest first (`app.playbook_check_candidates()`), and `readAt`,
 * the database time of the read as Postgres writes it, which the record stores as `checked_at`.
 */
export async function playbookCandidates(
  tx: RequestTx,
  directiveId: string,
  embedding: readonly number[],
  maxDistance: number,
  limit: number,
): Promise<{ readAt: string; candidates: PlaybookCandidate[] }> {
  const rows = (await tx.execute(
    sql`select other_id, title, body, distance, read_at::text as read_at
          from app.playbook_check_candidates(${directiveId}::uuid, ${`[${embedding.join(',')}]`},
                                             ${maxDistance}::real, ${limit}::integer)`,
  )) as unknown as {
    other_id: string;
    title: string;
    body: string;
    distance: number;
    read_at: string;
  }[];
  // With no candidate the read's time is the transaction's own (the definer answers `now()`).
  const readAt =
    rows[0]?.read_at ??
    ((await tx.execute(sql`select pg_catalog.now()::text as at`)) as unknown as { at: string }[])[0]
      ?.at;
  if (readAt === undefined) throw new DomainError('internal', 'the read had no time');
  return {
    readAt,
    candidates: rows.map((r) => ({
      otherId: r.other_id,
      title: r.title,
      text: r.body,
      distance: r.distance,
    })),
  };
}

/**
 * `knowledge.playbook.record_check` (docs/03-roadmap-appendix/phase2.md §5.4): what the conflict
 * check found on a draft, recorded by the platform's worker (`system:workers`, the platform-only
 * `knowledge.playbook.check`, no directive read permission) through `app.record_playbook_check()`,
 * which takes the type's lock and the draft's, and records nothing when it is no longer a draft,
 * its wording is no longer the one checked, or a newer check is already recorded (`skipped`). The
 * check's time is the candidates' read time. The audit row counts the pairs, never their text,
 * under the draft's company.
 */
export const recordPlaybookCheck = defineCommand({
  name: 'knowledge.playbook.record_check',
  permission: 'knowledge.playbook.check',
  minScope: 'entity',
  input: RecordPlaybookCheckInput,
  output: PlaybookCheckRecordDto,
  // The SHA-256 of the checked wording, in hex: a long run of digits by design.
  unmaskedFields: ['wordingSha256'],
  auditFields: ['pairs', 'openConflicts'],
  auditInput: (input) => ({ directiveId: input.directiveId, pairs: input.pairs.length }),
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const pairs = JSON.stringify(
      input.pairs.map((p) => ({
        id: newId(),
        otherId: p.otherId,
        distance: p.distance,
        label: p.label,
        reason: p.reason,
      })),
    );
    let answer: { open_pairs: number | null; entity_id: number | null } | undefined;
    try {
      const rows = (await ctx.tx.execute(
        sql`select open_pairs, entity_id
              from app.record_playbook_check(${input.directiveId}::uuid, ${input.wordingSha256},
                                             ${input.checkedAsOf}::timestamptz,
                                             ${`[${input.embedding.join(',')}]`}, ${pairs}::jsonb)`,
      )) as unknown as { open_pairs: number | null; entity_id: number | null }[];
      answer = rows[0];
    } catch (error) {
      if ((error as { cause?: { code?: string } }).cause?.code === 'P0002') {
        throw new DomainError('not_found', `directive ${input.directiveId} is not here`, {
          reason: 'playbook_directive_missing',
        });
      }
      throw error;
    }
    if (answer === undefined || answer.open_pairs === null) {
      return { directiveId: input.directiveId, skipped: true, pairs: 0, open: 0 };
    }
    // Filed under the draft's own company (null for the group's), not the event's.
    ctx.audit({
      aggregateType: 'playbook_directive',
      aggregateId: input.directiveId,
      entityId: answer.entity_id,
      after: { pairs: input.pairs.length, openConflicts: answer.open_pairs },
    });
    return {
      directiveId: input.directiveId,
      skipped: false,
      pairs: input.pairs.length,
      open: answer.open_pairs,
    };
  },
});
