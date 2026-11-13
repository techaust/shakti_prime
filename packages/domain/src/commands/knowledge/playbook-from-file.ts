import {
  DomainError,
  DraftFromVaultFileInput,
  PlaybookDraftsDto,
  type KnowledgeSensitivity,
  type PlaybookAudience,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { eq } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { requireEntity } from '../crm/opportunity-shared';
import { draftPlaybookDirective } from './playbook';

/** The audiences a directive drawn from a vault file of this sensitivity may have. */
export function audiencesFromSource(
  sensitivity: KnowledgeSensitivity,
): readonly PlaybookAudience[] {
  switch (sensitivity) {
    case 'staff_ai_ok':
      return ['customer', 'staff', 'management'];
    case 'management':
      return ['management'];
    case 'exec_only':
      return [];
  }
}

/**
 * `knowledge.playbook.draft_from_file` (docs/03-roadmap-appendix/phase2.md §5.4): the drafts the
 * model proposed from a vault file, written as drafts in one transaction, each citing the passage
 * it comes from. The file is one the caller reads, read for search; a directive is read by no more
 * people than its file (a management file gives management directives only, an Executive-only file
 * none). A file of a company gives that company's directives; a file of the whole group gives the
 * request's company's, or with `wholeGroup` the group's. Each draft is written by
 * `knowledge.playbook.draft`, with its own audit row and event.
 */
export const draftPlaybookFromFile = defineCommand({
  name: 'knowledge.playbook.draft_from_file',
  permission: 'knowledge.playbook.draft',
  minScope: 'all',
  peopleOnly: true,
  input: DraftFromVaultFileInput,
  output: PlaybookDraftsDto,
  auditFields: ['drafts'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const k = schema.knowledgeFiles;
    const [file] = await ctx.tx
      .select({ id: k.id, entityId: k.entityId, sensitivity: k.sensitivity, state: k.state })
      .from(k)
      .where(eq(k.id, input.knowledgeFileId))
      .limit(1);
    if (
      file?.state !== 'indexed' ||
      (file.entityId !== null && (file.entityId !== input.entityId || input.wholeGroup))
    ) {
      throw new DomainError('not_found', `vault file ${input.knowledgeFileId} is not usable`, {
        reason: 'playbook_source_missing',
      });
    }
    const allowed = audiencesFromSource(file.sensitivity as KnowledgeSensitivity);
    if (allowed.length === 0) {
      throw new DomainError('forbidden', 'an Executive-only file gives no directive', {
        reason: 'playbook_source_exec_only',
      });
    }
    const c = schema.knowledgeChunks;
    const positions = new Set(
      (
        await ctx.tx.select({ position: c.position }).from(c).where(eq(c.knowledgeFileId, file.id))
      ).map((r) => r.position),
    );
    for (const d of input.drafts) {
      if (!allowed.includes(d.audience)) {
        throw new DomainError('forbidden', 'a directive is read by no more people than its file', {
          reason: 'playbook_audience_above_source',
        });
      }
      if (!positions.has(d.sourcePosition)) {
        throw new DomainError('validation_failed', 'a draft cites a passage the file lacks', {
          reason: 'playbook_passage_missing',
        });
      }
    }
    const drafts = [];
    for (const d of input.drafts) {
      drafts.push(
        await ctx.run(draftPlaybookDirective, {
          entityId: input.entityId,
          wholeGroup: input.wholeGroup,
          type: d.type,
          audience: d.audience,
          title: d.title,
          text: d.text,
          sourceFileId: file.id,
          sourcePosition: d.sourcePosition,
        }),
      );
    }
    ctx.audit({
      aggregateType: 'knowledge_file',
      aggregateId: file.id,
      entityId: file.entityId,
      after: { drafts: drafts.length },
    });
    return { drafts };
  },
});
