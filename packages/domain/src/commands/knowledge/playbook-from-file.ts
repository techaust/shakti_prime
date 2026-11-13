import { DraftFromVaultFileInput, PlaybookDraftsDto } from '@shakti/contracts';
import { defineCommand } from '../../command/define-command';
import { requireEntity } from '../crm/opportunity-shared';
import { assertPlaybookSource } from './playbook-shared';
import { draftPlaybookDirective } from './playbook';

// The source rules and the audiences a file allows live in `playbook-shared.ts`.
export { audiencesFromSource } from './playbook-shared';

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
    const file = await assertPlaybookSource(ctx, {
      knowledgeFileId: input.knowledgeFileId,
      entityId: input.entityId,
      wholeGroup: input.wholeGroup,
      audiences: input.drafts.map((d) => d.audience),
      positions: input.drafts.map((d) => d.sourcePosition),
    });
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
