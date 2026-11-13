import { z } from 'zod';
import { EntityIdSchema, IdSchema } from './ids';
import { KNOWLEDGE_EMBEDDING_DIMENSIONS } from './knowledge';

// The Business Playbook (docs/03-roadmap-appendix/phase2.md §5.4, BLUEPRINT §9.1, PRD AI-01): typed
// directives an Executive approves before they steer any agent, each linked to its source, and the
// conflict check that flags a draft close to an approved directive of the same type.

/** What kind of rule a directive is (BLUEPRINT §9.1). */
export const PLAYBOOK_DIRECTIVE_TYPES = [
  'policy',
  'priority',
  'target',
  'sop',
  'faq',
  'tone',
] as const;
export const PlaybookDirectiveTypeSchema = z.enum(PLAYBOOK_DIRECTIVE_TYPES);
export type PlaybookDirectiveType = z.infer<typeof PlaybookDirectiveTypeSchema>;

/**
 * Who a directive is for: `customer` (an agent may state it to a customer) and `staff`, read with
 * `knowledge.vault.read.staff`; `management`, read with `knowledge.vault.read.management`.
 */
export const PLAYBOOK_AUDIENCES = ['customer', 'staff', 'management'] as const;
export const PlaybookAudienceSchema = z.enum(PLAYBOOK_AUDIENCES);
export type PlaybookAudience = z.infer<typeof PlaybookAudienceSchema>;

/** The permission that reads each audience, at scope `all` (SECURITY §3.2). */
export const PLAYBOOK_AUDIENCE_READ_PERMISSION = {
  customer: 'knowledge.vault.read.staff',
  staff: 'knowledge.vault.read.staff',
  management: 'knowledge.vault.read.management',
} as const satisfies Record<PlaybookAudience, string>;

/** `playbook_directives.state`, the `playbook_directive` machine. */
export const PLAYBOOK_DIRECTIVE_STATES = ['draft', 'approved', 'retired'] as const;
export const PlaybookDirectiveStateSchema = z.enum(PLAYBOOK_DIRECTIVE_STATES);
export type PlaybookDirectiveState = z.infer<typeof PlaybookDirectiveStateSchema>;

/** The label the conflict check gives a pair; `none` blocks nothing. */
export const PLAYBOOK_CONFLICT_LABELS = ['conflict', 'overlap', 'none'] as const;
export const PlaybookConflictLabelSchema = z.enum(PLAYBOOK_CONFLICT_LABELS);
export type PlaybookConflictLabel = z.infer<typeof PlaybookConflictLabelSchema>;

/** How an Executive resolved a conflict or an overlap. */
export const PLAYBOOK_RESOLUTIONS = ['not_a_conflict', 'other_retired'] as const;
export const PlaybookResolutionSchema = z.enum(PLAYBOOK_RESOLUTIONS);
export type PlaybookResolution = z.infer<typeof PlaybookResolutionSchema>;

export const PlaybookTitleSchema = z.string().trim().min(1).max(120);
export const PlaybookTextSchema = z.string().trim().min(1).max(2000);
/** A reason to retire a directive or a note on a resolution. */
export const PlaybookNoteSchema = z.string().trim().min(1).max(300);

/**
 * `knowledge.playbook.draft` (people only, `knowledge.playbook.draft`): a new draft for the
 * company the request acts for, or with `wholeGroup` for every company (a request for every
 * company). `sourceFileId` names the vault file it was taken from, and `sourcePosition` the passage.
 */
export const DraftPlaybookDirectiveInput = z
  .object({
    entityId: EntityIdSchema,
    wholeGroup: z.boolean().default(false),
    type: PlaybookDirectiveTypeSchema,
    audience: PlaybookAudienceSchema,
    title: PlaybookTitleSchema,
    text: PlaybookTextSchema,
    sourceFileId: IdSchema.nullable().default(null),
    sourcePosition: z.number().int().min(0).nullable().default(null),
  })
  .strict()
  .refine((v) => v.sourcePosition === null || v.sourceFileId !== null, {
    path: ['sourcePosition'],
    message: 'a passage needs its file',
  });
export type DraftPlaybookDirectiveInput = z.input<typeof DraftPlaybookDirectiveInput>;

/** `knowledge.playbook.edit`: a draft's new wording, type and audience. */
export const EditPlaybookDirectiveInput = z
  .object({
    entityId: EntityIdSchema,
    directiveId: IdSchema,
    type: PlaybookDirectiveTypeSchema,
    audience: PlaybookAudienceSchema,
    title: PlaybookTitleSchema,
    text: PlaybookTextSchema,
  })
  .strict();
export type EditPlaybookDirectiveInput = z.input<typeof EditPlaybookDirectiveInput>;

/** `knowledge.playbook.approve`: one draft. */
export const PlaybookDirectiveRefInput = z
  .object({ entityId: EntityIdSchema, directiveId: IdSchema })
  .strict();
export type PlaybookDirectiveRefInput = z.input<typeof PlaybookDirectiveRefInput>;

/** `knowledge.playbook.retire`: a draft or an approved directive, with the reason. */
export const RetirePlaybookDirectiveInput = z
  .object({ entityId: EntityIdSchema, directiveId: IdSchema, reason: PlaybookNoteSchema })
  .strict();
export type RetirePlaybookDirectiveInput = z.input<typeof RetirePlaybookDirectiveInput>;

/**
 * `knowledge.playbook.resolve_conflict`: an open conflict or overlap is not a conflict (with a
 * note saying why), or is settled by retiring the other directive (the note is its reason).
 */
export const ResolvePlaybookConflictInput = z
  .object({
    entityId: EntityIdSchema,
    checkId: IdSchema,
    resolution: PlaybookResolutionSchema,
    note: PlaybookNoteSchema,
  })
  .strict();
export type ResolvePlaybookConflictInput = z.input<typeof ResolvePlaybookConflictInput>;

/** A directive as the Playbook screen and the commands answer it; never its embedding. */
export const PlaybookDirectiveDto = z
  .object({
    id: IdSchema,
    /** Null for a directive of the whole group. */
    entityId: EntityIdSchema.nullable(),
    type: PlaybookDirectiveTypeSchema,
    audience: PlaybookAudienceSchema,
    title: z.string(),
    text: z.string(),
    sourceFileId: IdSchema.nullable(),
    sourcePosition: z.number().int().min(0).nullable(),
    state: PlaybookDirectiveStateSchema,
    approvedBy: IdSchema.nullable(),
    approvedAt: z.iso.datetime().nullable(),
    retiredReason: z.string().nullable(),
    retiredAt: z.iso.datetime().nullable(),
    /** Approved directives in conflict or overlap that nobody has resolved yet. */
    conflictsWith: z.array(IdSchema),
    /** When the conflict check last ran on this wording; null while it is still to run. */
    checkedAt: z.iso.datetime().nullable(),
    createdBy: IdSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type PlaybookDirectiveDto = z.infer<typeof PlaybookDirectiveDto>;

/** One pair the conflict check compared, with its label and how it was resolved. */
export const PlaybookConflictCheckDto = z
  .object({
    id: IdSchema,
    directiveId: IdSchema,
    otherId: IdSchema,
    distance: z.number().min(0).max(2),
    label: PlaybookConflictLabelSchema.nullable(),
    reason: z.string().nullable(),
    resolution: PlaybookResolutionSchema.nullable(),
    resolutionNote: z.string().nullable(),
    resolvedBy: IdSchema.nullable(),
    resolvedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type PlaybookConflictCheckDto = z.infer<typeof PlaybookConflictCheckDto>;

/** One pair the conflict check labelled; `label` null when the model could not label it. */
export const PlaybookCheckPairInput = z
  .object({
    otherId: IdSchema,
    distance: z.number().min(0).max(2),
    label: PlaybookConflictLabelSchema.nullable(),
    reason: z.string().trim().min(1).max(300).nullable(),
  })
  .strict()
  .refine((p) => (p.label === null) === (p.reason === null), {
    path: ['reason'],
    message: 'a label comes with its reason',
  });

/** The most candidates one check may record (`AGENT_DEFAULTS.playbook.candidatesPerCheck` or fewer). */
export const PLAYBOOK_MAX_CANDIDATES = 20;

/**
 * `knowledge.playbook.record_check` (the conflict check, `knowledge.playbook.check`): a draft's
 * embedding and the labelled pairs, for the wording whose SHA-256 is `textSha256`. `entityId` is
 * the company the worker acts in.
 */
export const RecordPlaybookCheckInput = z
  .object({
    entityId: EntityIdSchema,
    directiveId: IdSchema,
    textSha256: z.string().regex(/^[0-9a-f]{64}$/),
    embedding: z.array(z.number()).length(KNOWLEDGE_EMBEDDING_DIMENSIONS),
    pairs: z.array(PlaybookCheckPairInput).max(PLAYBOOK_MAX_CANDIDATES),
  })
  .strict();
export type RecordPlaybookCheckInput = z.input<typeof RecordPlaybookCheckInput>;

/** What the record came to: `skipped` when the draft changed or was decided meanwhile. */
export const PlaybookCheckRecordDto = z
  .object({
    directiveId: IdSchema,
    skipped: z.boolean(),
    pairs: z.number().int().min(0),
    open: z.number().int().min(0),
  })
  .strict();
export type PlaybookCheckRecordDto = z.infer<typeof PlaybookCheckRecordDto>;
