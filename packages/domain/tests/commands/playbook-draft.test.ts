import {
  newId,
  type KnowledgeSensitivity,
  type PlaybookFileDraftInput,
  type Principal,
} from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import type { output, ZodType } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENT_DEFAULTS } from '../../src/ai/agent-defaults';
import { createAiProvider } from '../../src/ai/provider';
import { fakeModelTransport, fakeReply } from '../../src/ai/transport';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { Command } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { editPlaybookDirective } from '../../src/commands/knowledge/playbook';
import { draftPlaybookFromFile } from '../../src/commands/knowledge/playbook-from-file';
import { filterDrafts, proposeDirectives } from '../../src/knowledge/playbook-draft';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { memoryKeyValue } from '../../src/ports/key-value';
import { memoryLogger } from '../../src/ports/logger';
import {
  listPlaybook,
  loadPlaybookReview,
  playbookSourcePassages,
} from '../../src/queries/knowledge/playbook';

// Drafting directives from a vault file, and the Playbook's list and review sheet, on real
// Postgres (docs/03-roadmap-appendix/phase2.md §5.4). The model is the fake transport; every text
// is synthetic.

const made = { files: [] as string[], vault: [] as string[] };

afterAll(async () => {
  await asMigrator(async (m) => {
    await m`delete from playbook_conflict_checks where directive_id in
              (select id from playbook_directives where source_file_id = any(${made.vault}))`;
    await m`delete from playbook_directives where source_file_id = any(${made.vault})`;
    await m`delete from knowledge_chunks where knowledge_file_id = any(${made.vault})`;
    await m`delete from knowledge_files where id = any(${made.vault})`;
    await m`delete from files where id = any(${made.files})`;
  });
  await closeDb();
});

let executive: Principal;
let gm: Principal;

beforeAll(async () => {
  executive = await createTestPrincipal('executive');
  gm = await createTestPrincipal('general_manager');
});

const run = <I extends ZodType, O extends ZodType>(
  principal: Principal,
  command: Command<I, O>,
  input: unknown,
): Promise<output<O>> =>
  asPrincipal(principal, (context) => runCommand(command, { context, audit, outbox }, input));

/** An indexed vault file with three synthetic passages, written as the owner. */
async function vaultFile(sensitivity: KnowledgeSensitivity, entityId: number | null = 1) {
  const upload = newId();
  const file = newId();
  await asMigrator(async (m) => {
    await m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
      values (${upload}, ${entityId ?? 1}, 'knowledge', 'test', ${`1/knowledge/${upload}.pdf`}, 'vault.pdf',
              'application/pdf', 10, ${'e'.repeat(64)}, 'ready', ${executive.id})`;
    await m`insert into knowledge_files (id, entity_id, file_id, title, sensitivity, source_type, state, chunks, created_by)
      values (${file}, ${entityId}, ${upload}, 'Synthetic rules file', ${sensitivity}, 'pdf', 'indexed', 3, ${executive.id})`;
    for (const position of [0, 1, 2]) {
      await m`insert into knowledge_chunks (id, knowledge_file_id, entity_id, sensitivity, position, chunk_text, embedding)
        values (${newId()}, ${file}, ${entityId}, ${sensitivity}, ${position},
                ${`Synthetic passage ${String(position)}.`}, array_fill(0.1::real, array[1024])::vector)`;
    }
  });
  made.files.push(upload);
  made.vault.push(file);
  return file;
}

const draft = (over: Partial<PlaybookFileDraftInput> = {}): PlaybookFileDraftInput => ({
  type: 'faq',
  audience: 'staff',
  title: 'Synthetic drafted rule',
  text: `Synthetic drafted text ${newId()}`,
  sourcePosition: 1,
  ...over,
});

const fromFile = (
  who: Principal,
  knowledgeFileId: string,
  drafts: PlaybookFileDraftInput[],
  over: { entityId?: number; wholeGroup?: boolean } = {},
) =>
  run(who, draftPlaybookFromFile, {
    entityId: over.entityId ?? 1,
    knowledgeFileId,
    wholeGroup: over.wholeGroup ?? false,
    drafts,
  });

describe('knowledge.playbook.draft_from_file', () => {
  it('is refused without the grant, to an agent and for another company', async () => {
    const file = await vaultFile('staff_ai_ok');
    await expect(
      fromFile(principalFor('tele_caller_cc', [1]), file, [draft()]),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      fromFile(principalFor('agent:copilot', [1]), file, [draft()]),
    ).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'people_only' } });
    await expect(fromFile(gm, file, [draft()], { entityId: 2 })).rejects.toMatchObject({
      code: 'not_found',
      details: { reason: 'playbook_source_missing' },
    });
  });

  it('writes each draft citing its passage, for the file’s company', async () => {
    const file = await vaultFile('staff_ai_ok');
    const { drafts } = await fromFile(gm, file, [
      draft(),
      draft({ type: 'sop', sourcePosition: 2 }),
    ]);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({
      entityId: 1,
      state: 'draft',
      sourceFileId: file,
      sourcePosition: 1,
      createdBy: gm.id,
    });
    const review = await asPrincipal(gm, (ctx) =>
      loadPlaybookReview(ctx, { directiveId: drafts[0]?.id }),
    );
    expect(review.source).toEqual({
      knowledgeFileId: file,
      title: 'Synthetic rules file',
      position: 1,
      text: 'Synthetic passage 1.',
    });
  });

  it('keeps a directive to no more people than its file, and cites only passages it has', async () => {
    const management = await vaultFile('management');
    await expect(fromFile(gm, management, [draft()])).rejects.toMatchObject({
      details: { reason: 'playbook_audience_above_source' },
    });
    const { drafts } = await fromFile(gm, management, [draft({ audience: 'management' })]);
    // Nor may an edit widen it afterwards, in the command or past it in the database.
    await expect(
      run(gm, editPlaybookDirective, {
        entityId: 1,
        directiveId: drafts[0]?.id,
        type: 'faq',
        audience: 'staff',
        title: 'Synthetic drafted rule',
        text: 'Synthetic widened text',
      }),
    ).rejects.toMatchObject({ details: { reason: 'playbook_audience_above_source' } });
    const executiveOnly = await vaultFile('exec_only');
    await expect(fromFile(executive, executiveOnly, [draft()])).rejects.toMatchObject({
      details: { reason: 'playbook_source_exec_only' },
    });
    const file = await vaultFile('staff_ai_ok');
    await expect(fromFile(gm, file, [draft({ sourcePosition: 9 })])).rejects.toMatchObject({
      details: { reason: 'playbook_passage_missing' },
    });
  });

  it('gives a group file’s directives to the request’s company, or the group from every company', async () => {
    const file = await vaultFile('staff_ai_ok', null);
    const one = await fromFile(gm, file, [draft()]);
    expect(one.drafts[0]?.entityId).toBe(1);
    const group = await fromFile(executive, file, [draft()], { wholeGroup: true });
    expect(group.drafts[0]?.entityId).toBeNull();
  });
});

describe('the drafting model', () => {
  it('reads the masked passages with Sonnet 5.5 and keeps only drafts it may write', async () => {
    const file = await vaultFile('management');
    const source = await asPrincipal(gm, (ctx) => playbookSourcePassages(ctx, file, 60));
    if (source === undefined) throw new Error('no source');
    expect(source.passages.map((p) => p.position)).toEqual([0, 1, 2]);
    const answer = JSON.stringify({
      drafts: [
        { type: 'faq', audience: 'management', title: 'Kept', text: 'A kept rule.', passage: 0 },
        { type: 'faq', audience: 'staff', title: 'Wider', text: 'Too wide.', passage: 0 },
        { type: 'pricing', audience: 'management', title: 'Type', text: 'No type.', passage: 0 },
        { type: 'faq', audience: 'management', title: 'Far', text: 'No passage.', passage: 7 },
        { type: 'faq', audience: 'management', title: 'Kept', text: 'A kept rule.', passage: 1 },
      ],
    });
    const transport = fakeModelTransport([fakeReply(answer)]);
    const ai = createAiProvider({
      claude: transport,
      voyage: transport,
      keyValue: memoryKeyValue(),
      logger: memoryLogger(),
    });
    const drafts = await proposeDirectives(ai, source, gm.id);
    expect(drafts).toEqual([
      {
        type: 'faq',
        audience: 'management',
        title: 'Kept',
        text: 'A kept rule.',
        sourcePosition: 0,
      },
    ]);
    expect(transport.requests[0]).toMatchObject({
      model: AGENT_DEFAULTS.playbook.draftModel,
      effort: 'medium',
    });
    expect(transport.requests[0]?.user).toContain('Synthetic passage 2.');
  });

  it('says drafting is not set up without a model key, and refuses an Executive-only file', async () => {
    const file = await vaultFile('staff_ai_ok');
    const source = await asPrincipal(gm, (ctx) => playbookSourcePassages(ctx, file, 60));
    if (source === undefined) throw new Error('no source');
    const ai = createAiProvider({
      claude: undefined,
      voyage: undefined,
      keyValue: memoryKeyValue(),
      logger: memoryLogger(),
    });
    await expect(proposeDirectives(ai, source, gm.id)).rejects.toMatchObject({
      details: { reason: 'playbook_drafting_unavailable' },
    });
    await expect(
      proposeDirectives(
        ai,
        { ...source, file: { ...source.file, sensitivity: 'exec_only' } },
        gm.id,
      ),
    ).rejects.toMatchObject({ details: { reason: 'playbook_source_exec_only' } });
    expect(filterDrafts('not an answer', source)).toEqual([]);
  });
});

describe('the Playbook list', () => {
  it('lists by state, type and company for a drafter, and is refused to anyone else', async () => {
    const file = await vaultFile('staff_ai_ok');
    const { drafts } = await fromFile(gm, file, [draft({ type: 'tone' })]);
    const page = await asPrincipal(gm, (ctx) =>
      listPlaybook(ctx, { state: 'draft', type: 'tone', company: 1 }),
    );
    expect(page.directives.map((d) => d.id)).toContain(drafts[0]?.id);
    expect(page.directives.every((d) => d.state === 'draft' && d.type === 'tone')).toBe(true);
    const group = await asPrincipal(gm, (ctx) => listPlaybook(ctx, { company: 'group' }));
    expect(group.directives.every((d) => d.entityId === null)).toBe(true);
    await expect(
      asPrincipal(principalFor('accounts', [1]), (ctx) => listPlaybook(ctx, {})),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
