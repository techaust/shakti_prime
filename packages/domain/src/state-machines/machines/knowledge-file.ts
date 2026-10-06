import { defineMachine } from '../define-machine';

export const KNOWLEDGE_FILE_MACHINE_STATES = [
  'waiting',
  'indexed',
  'failed',
  'unavailable',
  'archived',
] as const;
export type KnowledgeFileMachineState = (typeof KNOWLEDGE_FILE_MACHINE_STATES)[number];
export type KnowledgeFileEvent = 'add' | 'index' | 'fail' | 'hold' | 'reindex' | 'archive';

/** What the vault commands preload for the machine. */
export interface KnowledgeFileRecord {
  state: KnowledgeFileMachineState | null;
}

/**
 * A Knowledge Vault file (docs/design/phase1.md §8.4, PRD AI-01, BLUEPRINT §9.1): added waiting to
 * be read; the index job reads it, cuts its text into passages and embeds them, or records why it
 * could not; an Executive or GM indexes it again or archives it, which takes its passages out of
 * search.
 */
export const knowledgeFileMachine = defineMachine<
  KnowledgeFileMachineState,
  KnowledgeFileEvent,
  KnowledgeFileRecord,
  undefined
>({
  name: 'knowledge_file',
  title: 'Knowledge Vault file',
  summary:
    '`knowledge_files.state`. A vault upload with its title and sensitivity, for one company or the whole group. Added and archived by a person holding `knowledge.vault.write`; read and indexed by the index job (`system:workers`, `knowledge.index`) through `/api/v1/workers/embeddings/index`.',
  sources: [
    'docs/design/phase1.md §8.4',
    'PRD AI-01',
    'BLUEPRINT §9.1',
    'DATABASE §6.9 `knowledge_files`',
  ],
  states: KNOWLEDGE_FILE_MACHINE_STATES,
  initial: 'waiting',
  terminal: ['archived'],
  stored: { table: 'knowledge_files', stateColumn: 'state' },
  stateNotes: {
    waiting:
      'Waiting for its upload to pass its checks and for the index job to read it; earlier passages stay in search until new ones replace them.',
    indexed: 'Its passages are in search for whoever may read its sensitivity.',
    failed: 'The index job could not read it; the reason is kept and an Executive may index it again.',
    unavailable:
      'No key for the reading or search service is set yet; indexed again once one is.',
    archived: 'Out of search: its passages are removed.',
  },
  transitions: [
    {
      from: 'new',
      event: 'add',
      to: 'waiting',
      permission: 'knowledge.vault.write',
      scope: 'all',
      emits: 'knowledge.file.index_requested',
      note: '`knowledge.file.add`, people only, from the person’s own vault upload; the event is sent at once when the upload has passed its checks, and otherwise by `files.file.mark_ready` when it does.',
    },
    {
      from: ['waiting'],
      event: 'index',
      to: 'indexed',
      permission: null,
      system: true,
      note: '`knowledge.file.record_index`: the passages replace the file’s earlier ones in one transaction.',
    },
    {
      from: ['waiting'],
      event: 'fail',
      to: 'failed',
      permission: null,
      system: true,
      note: '`knowledge.file.record_index`, or `files.file.reject` when the upload fails its checks.',
    },
    {
      from: ['waiting'],
      event: 'hold',
      to: 'unavailable',
      permission: null,
      system: true,
      note: '`knowledge.file.record_index` when `ANTHROPIC_API_KEY` or `VOYAGE_API_KEY` is not set.',
    },
    {
      from: ['indexed', 'failed', 'unavailable'],
      event: 'reindex',
      to: 'waiting',
      permission: 'knowledge.vault.write',
      scope: 'all',
      emits: 'knowledge.file.index_requested',
      note: '`knowledge.file.reindex`, people only; refused while the upload has not passed its checks.',
    },
    {
      from: ['waiting', 'indexed', 'failed', 'unavailable'],
      event: 'archive',
      to: 'archived',
      permission: 'knowledge.vault.write',
      scope: 'all',
      effects: [{ key: 'unsearchable', description: 'remove the file’s passages from search' }],
      note: '`knowledge.file.archive`, people only.',
    },
  ],
});
