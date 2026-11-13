import {
  DomainError,
  newId,
  PlaybookCheckRecordDto,
  RecordPlaybookCheckInput,
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
  title: string;
  text: string;
  textSha256: string;
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
    sql`select directive_id, entity_id, type, title, body, text_sha256, embedding
          from app.playbook_check_targets(${directiveId}::uuid)`,
  )) as unknown as {
    directive_id: string;
    entity_id: number | null;
    type: PlaybookDirectiveType;
    title: string;
    body: string;
    text_sha256: string;
    embedding: string | null;
  }[];
  return rows.map((r) => ({
    directiveId: r.directive_id,
    entityId: r.entity_id,
    type: r.type,
    title: r.title,
    text: r.body,
    textSha256: r.text_sha256,
    embedding: vectorOf(r.embedding),
  }));
}

/** A draft's conflict candidates, nearest first (`app.playbook_check_candidates()`). */
export async function playbookCandidates(
  tx: RequestTx,
  directiveId: string,
  embedding: readonly number[],
  maxDistance: number,
  limit: number,
): Promise<PlaybookCandidate[]> {
  const rows = (await tx.execute(
    sql`select other_id, title, body, distance
          from app.playbook_check_candidates(${directiveId}::uuid, ${`[${embedding.join(',')}]`},
                                             ${maxDistance}::real, ${limit}::integer)`,
  )) as unknown as { other_id: string; title: string; body: string; distance: number }[];
  return rows.map((r) => ({
    otherId: r.other_id,
    title: r.title,
    text: r.body,
    distance: r.distance,
  }));
}

/**
 * `knowledge.playbook.record_check` (docs/03-roadmap-appendix/phase2.md §5.4): what the conflict
 * check found on a draft, recorded by the platform's worker (`system:workers`, the platform-only
 * `knowledge.playbook.check`, no directive read permission) through `app.record_playbook_check()`,
 * which locks the draft and records nothing when it is no longer a draft or its wording is no
 * longer the one checked (`skipped`). The audit row counts the pairs, never their text.
 */
export const recordPlaybookCheck = defineCommand({
  name: 'knowledge.playbook.record_check',
  permission: 'knowledge.playbook.check',
  minScope: 'entity',
  input: RecordPlaybookCheckInput,
  output: PlaybookCheckRecordDto,
  // The SHA-256 of the checked wording, in hex: a long run of digits by design.
  unmaskedFields: ['textSha256'],
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
    let open: number | null;
    try {
      const rows = (await ctx.tx.execute(
        sql`select app.record_playbook_check(${input.directiveId}::uuid, ${input.textSha256},
                                             ${`[${input.embedding.join(',')}]`}, ${pairs}::jsonb) as open`,
      )) as unknown as { open: number | null }[];
      open = rows[0]?.open ?? null;
    } catch (error) {
      if ((error as { cause?: { code?: string } }).cause?.code === 'P0002') {
        throw new DomainError('not_found', `directive ${input.directiveId} is not here`, {
          reason: 'playbook_directive_missing',
        });
      }
      throw error;
    }
    if (open === null) {
      return { directiveId: input.directiveId, skipped: true, pairs: 0, open: 0 };
    }
    ctx.audit({
      aggregateType: 'playbook_directive',
      aggregateId: input.directiveId,
      entityId: input.entityId,
      after: { pairs: input.pairs.length, openConflicts: open },
    });
    return { directiveId: input.directiveId, skipped: false, pairs: input.pairs.length, open };
  },
});
