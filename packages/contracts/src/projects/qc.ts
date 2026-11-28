import { z } from 'zod';
import { EntityIdSchema, IdSchema } from '../ids';
import { ProjectSegmentSchema, MilestoneStateSchema } from './enums';
import { StepKeySchema } from './projects';
import { ProjectPersonDto } from './reads';

/**
 * QC checklists and inspections (J6, docs/03-roadmap-appendix/phase4.md §7.3, the QC step of PRD
 * PRJ-02): the commands' inputs, the strict DTOs they answer and the project page's QC tab.
 */

/**
 * What an item asks for: a yes or no, a number within its bounds, a few words, or one or more
 * photos. Paired with `checklists.items_json` by the contract alone (the column is JSON).
 */
export const ChecklistItemKindSchema = z.enum(['yes_no', 'number', 'text', 'photo_required']);
export type ChecklistItemKind = z.infer<typeof ChecklistItemKindSchema>;

/** `qc_inspections.state`, as the `qc_inspection` machine moves it. */
export const QcInspectionStateSchema = z.enum(['submitted', 'signed_off', 'rejected']);
export type QcInspectionState = z.infer<typeof QcInspectionStateSchema>;

/** The most items a checklist holds (`checklists_items_check`). */
export const CHECKLIST_ITEMS_MAX = 40;
/** The most photos one item takes, and a text answer's length. */
export const QC_PHOTOS_PER_ITEM_MAX = 5;
export const QC_TEXT_MAX = 500;
/** The bounds a number item may set, and so the largest number an answer holds. */
export const QC_NUMBER_LIMIT = 1_000_000;

const Bound = z.number().finite().min(-QC_NUMBER_LIMIT).max(QC_NUMBER_LIMIT);

/** One item of a checklist, as an Executive writes it. Bounds only on a number item. */
export const ChecklistItemSchema = z
  .object({
    key: StepKeySchema,
    label: z.string().trim().min(1).max(120),
    kind: ChecklistItemKindSchema,
    min: Bound.nullable().default(null),
    max: Bound.nullable().default(null),
  })
  .strict()
  .refine((item) => item.kind === 'number' || (item.min === null && item.max === null), {
    message: 'only a number has bounds',
    path: ['min'],
  })
  .refine((item) => item.min === null || item.max === null || item.min <= item.max, {
    message: 'the lowest is not above the highest',
    path: ['max'],
  });
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

/** A checklist's items in order, each key once; none takes the checklist off the step. */
export const ChecklistItemsSchema = z
  .array(ChecklistItemSchema)
  .max(CHECKLIST_ITEMS_MAX)
  .refine((items) => new Set(items.map((i) => i.key)).size === items.length, {
    message: 'each item once',
  });

/**
 * `projects.checklist.publish`: a new version of one company's checklist for a segment's step.
 * An empty list takes the checklist off the step from then on.
 */
export const PublishChecklistInput = z
  .object({
    entityId: EntityIdSchema,
    segment: ProjectSegmentSchema,
    stepKey: StepKeySchema,
    items: ChecklistItemsSchema,
  })
  .strict();
export type PublishChecklistInput = z.input<typeof PublishChecklistInput>;

export const ChecklistDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    segment: ProjectSegmentSchema,
    stepKey: StepKeySchema,
    version: z.number().int().min(1),
    items: ChecklistItemsSchema,
    publishedAt: z.iso.datetime(),
    publishedBy: IdSchema,
  })
  .strict();
export type ChecklistDto = z.infer<typeof ChecklistDto>;

/**
 * One answer as the form sends it: a yes or no, a number, a few words, or the ids of the photos
 * uploaded for it (file purpose `qc_photo`). The command checks each against its item's kind.
 */
export const QcAnswerValueSchema = z.union([
  z.boolean(),
  z.number().finite().min(-QC_NUMBER_LIMIT).max(QC_NUMBER_LIMIT),
  z.string().trim().min(1).max(QC_TEXT_MAX),
  z
    .array(IdSchema)
    .min(1)
    .max(QC_PHOTOS_PER_ITEM_MAX)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'each photo once' }),
]);
export type QcAnswerValue = z.infer<typeof QcAnswerValueSchema>;

export const QcAnswerSchema = z.object({ key: StepKeySchema, value: QcAnswerValueSchema }).strict();
export type QcAnswer = z.infer<typeof QcAnswerSchema>;

/**
 * `projects.qc.submit`: a project's filled checklist for its open step, on the checklist version
 * the form showed (a newer one answers `qc_checklist_changed`), one answer per item.
 */
export const SubmitQcInput = z
  .object({
    entityId: EntityIdSchema,
    projectId: IdSchema,
    milestoneKey: StepKeySchema,
    checklistId: IdSchema,
    answers: z
      .array(QcAnswerSchema)
      .max(CHECKLIST_ITEMS_MAX)
      .refine((answers) => new Set(answers.map((a) => a.key)).size === answers.length, {
        message: 'each item once',
      }),
  })
  .strict();
export type SubmitQcInput = z.input<typeof SubmitQcInput>;

/** `projects.qc.signoff`: an inspection waiting for a decision. */
export const SignoffQcInput = z
  .object({ entityId: EntityIdSchema, inspectionId: IdSchema })
  .strict();
export type SignoffQcInput = z.input<typeof SignoffQcInput>;

/** `projects.qc.reject`: an inspection turned down, with what to put right. */
export const RejectQcInput = z
  .object({
    entityId: EntityIdSchema,
    inspectionId: IdSchema,
    reason: z.string().trim().min(1).max(300),
  })
  .strict();
export type RejectQcInput = z.input<typeof RejectQcInput>;

export const QcInspectionDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    projectId: IdSchema,
    milestoneId: IdSchema,
    checklistId: IdSchema,
    checklistVersion: z.number().int().min(1),
    /** The items the inspection was filled on, from its own checklist version. */
    items: ChecklistItemsSchema,
    state: QcInspectionStateSchema,
    answers: z.array(QcAnswerSchema),
    submittedAt: z.iso.datetime(),
    submittedBy: IdSchema,
    decidedAt: z.iso.datetime().nullable(),
    decidedBy: IdSchema.nullable(),
    rejectReason: z.string().nullable(),
  })
  .strict();
export type QcInspectionDto = z.infer<typeof QcInspectionDto>;

/** The project page's QC tab. */
export const ProjectQcInput = z.object({ entityId: EntityIdSchema, projectId: IdSchema }).strict();
export type ProjectQcInput = z.input<typeof ProjectQcInput>;

/**
 * Each step of the project that has a checklist now or had an inspection: the step, the checklist
 * a new inspection is filled on (null once taken off), and its inspections, newest first.
 */
export const ProjectQcStepDto = z
  .object({
    milestoneId: IdSchema,
    key: StepKeySchema,
    title: z.string().nullable(),
    state: MilestoneStateSchema,
    checklist: ChecklistDto.nullable(),
    inspections: z.array(QcInspectionDto),
  })
  .strict();
export type ProjectQcStepDto = z.infer<typeof ProjectQcStepDto>;

export const ProjectQcDto = z
  .object({
    steps: z.array(ProjectQcStepDto),
    /** Whoever submitted or decided an inspection, by id. */
    people: z.array(ProjectPersonDto),
  })
  .strict();
export type ProjectQcDto = z.infer<typeof ProjectQcDto>;

/** Settings › Checklists: the current checklist of each segment's steps in one company. */
export const ChecklistsInput = z.object({ entityId: EntityIdSchema }).strict();
export type ChecklistsInput = z.input<typeof ChecklistsInput>;

export const ChecklistsDto = z
  .object({
    segments: z.array(
      z
        .object({
          segment: ProjectSegmentSchema,
          /** The steps of the segment's current flow template, else the default steps. */
          steps: z.array(
            z
              .object({
                key: StepKeySchema,
                title: z.string().nullable(),
                current: ChecklistDto.nullable(),
                versions: z.number().int().min(0),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();
export type ChecklistsDto = z.infer<typeof ChecklistsDto>;
