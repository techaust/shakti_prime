import { z } from 'zod';
import { SubsidySchemeSchema } from '../crm/sizing';
import { EntityIdSchema, IdSchema } from '../ids';
import {
  DraftSkipReasonSchema,
  MilestoneStateSchema,
  ProjectFlowSchema,
  ProjectSegmentSchema,
  ProjectStateSchema,
} from './enums';

/**
 * Projects, their milestones and the flow templates (J1, docs/03-roadmap-appendix/phase4.md §5,
 * §6.1): the commands' inputs and the strict DTOs they answer.
 */

/** A step's or a document requirement's key: lower case, digits and `_`, as the database checks. */
export const StepKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{0,39}$/);

/** The most steps a checklist holds, and the most documents one step requires. */
export const PROJECT_STEPS_MAX = 30;
export const STEP_REQUIRES_MAX = 20;

/** One step of a flow template, as an Executive writes it. */
export const ProjectStepSchema = z
  .object({
    key: StepKeySchema,
    title: z.string().trim().min(1).max(80),
    /** The document requirement keys (J3) the step needs before it is done. */
    requires: z
      .array(StepKeySchema)
      .max(STEP_REQUIRES_MAX)
      .default([])
      .refine((keys) => new Set(keys).size === keys.length, { message: 'each document once' }),
  })
  .strict();
export type ProjectStep = z.infer<typeof ProjectStepSchema>;

/** A template's steps in order, each key once (`project_flow_templates.steps_json`). */
export const ProjectStepsSchema = z
  .array(ProjectStepSchema)
  .min(1)
  .max(PROJECT_STEPS_MAX)
  .refine((steps) => new Set(steps.map((s) => s.key)).size === steps.length, {
    message: 'each step once',
  });

/** `projects.template.publish`: a new version of one company's checklist for a segment. */
export const PublishProjectTemplateInput = z
  .object({ entityId: EntityIdSchema, segment: ProjectSegmentSchema, steps: ProjectStepsSchema })
  .strict();
export type PublishProjectTemplateInput = z.input<typeof PublishProjectTemplateInput>;

export const ProjectTemplateDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    segment: ProjectSegmentSchema,
    version: z.number().int().min(1),
    steps: ProjectStepsSchema,
    publishedAt: z.iso.datetime(),
    publishedBy: IdSchema,
  })
  .strict();
export type ProjectTemplateDto = z.infer<typeof ProjectTemplateDto>;

/**
 * `projects.project.create`: a Project Manager's or General Manager's project for a confirmed
 * order. The segment is the one named, else the order's lead's; `segment` is needed when the
 * lead's is no install segment (a dealer's order has none).
 */
export const CreateProjectInput = z
  .object({
    entityId: EntityIdSchema,
    orderId: IdSchema,
    segment: ProjectSegmentSchema.nullable().default(null),
  })
  .strict();
export type CreateProjectInput = z.input<typeof CreateProjectInput>;

/** `projects.project.draft`: the platform's project for an order just confirmed. */
export const DraftProjectInput = z.object({ entityId: EntityIdSchema, orderId: IdSchema }).strict();
export type DraftProjectInput = z.input<typeof DraftProjectInput>;

export const DraftProjectDto = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('drafted'), projectId: IdSchema }).strict(),
  z.object({ outcome: z.literal('skipped'), because: DraftSkipReasonSchema }).strict(),
]);
export type DraftProjectDto = z.infer<typeof DraftProjectDto>;

/**
 * `projects.project.cancel_for_order` (the platform, on `sales.order.cancelled`): the project of a
 * cancelled order is cancelled while none of its steps is done, else kept for its Project Manager
 * to close; `none` when the order has no project to close.
 */
export const CancelForOrderInput = z
  .object({ entityId: EntityIdSchema, orderId: IdSchema })
  .strict();
export type CancelForOrderInput = z.input<typeof CancelForOrderInput>;

export const CancelForOrderDto = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('cancelled'), projectId: IdSchema }).strict(),
  z.object({ outcome: z.literal('kept'), projectId: IdSchema }).strict(),
  z.object({ outcome: z.literal('none') }).strict(),
]);
export type CancelForOrderDto = z.infer<typeof CancelForOrderDto>;

/** A project of a company: `projects.project.resume` and `.complete`. */
export const ProjectRefInput = z.object({ entityId: EntityIdSchema, projectId: IdSchema }).strict();
export type ProjectRefInput = z.input<typeof ProjectRefInput>;

/** `projects.project.hold` and `.cancel`: a project and why, in the person's words. */
export const ProjectReasonInput = z
  .object({
    entityId: EntityIdSchema,
    projectId: IdSchema,
    reason: z.string().trim().min(1).max(300),
  })
  .strict();
export type ProjectReasonInput = z.input<typeof ProjectReasonInput>;

/** `projects.milestone.complete`: the next open step of a project, by its key. */
export const CompleteMilestoneInput = z
  .object({ entityId: EntityIdSchema, projectId: IdSchema, milestoneKey: StepKeySchema })
  .strict();
export type CompleteMilestoneInput = z.input<typeof CompleteMilestoneInput>;

/** The most people on one project. */
export const PROJECT_ASSIGNEES_MAX = 20;

/**
 * `projects.project.assign`: who runs the project (its owner, the Project Manager) and the people
 * on it, each a person of the company; the list replaces the one before.
 */
export const AssignProjectInput = z
  .object({
    entityId: EntityIdSchema,
    projectId: IdSchema,
    ownerId: IdSchema.nullable(),
    assigneeIds: z
      .array(IdSchema)
      .max(PROJECT_ASSIGNEES_MAX)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'each person once' }),
  })
  .strict();
export type AssignProjectInput = z.input<typeof AssignProjectInput>;

export const ProjectMilestoneDto = z
  .object({
    id: IdSchema,
    position: z.number().int().min(1),
    key: StepKeySchema,
    /** The Executive's words, or null for a step of the default list (named from the catalogue). */
    title: z.string().nullable(),
    state: MilestoneStateSchema,
    requires: z.array(StepKeySchema),
    doneAt: z.iso.datetime().nullable(),
    doneBy: IdSchema.nullable(),
  })
  .strict();
export type ProjectMilestoneDto = z.infer<typeof ProjectMilestoneDto>;

export const ProjectDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    projectNo: z.string().min(1),
    salesOrderId: IdSchema,
    accountId: IdSchema,
    siteId: IdSchema.nullable(),
    segment: ProjectSegmentSchema,
    scheme: SubsidySchemeSchema,
    flow: ProjectFlowSchema,
    templateVersionId: IdSchema.nullable(),
    state: ProjectStateSchema,
    stateChangedAt: z.iso.datetime(),
    ownerId: IdSchema.nullable(),
    holdReason: z.string().nullable(),
    cancelReason: z.string().nullable(),
    createdAt: z.iso.datetime(),
    milestones: z.array(ProjectMilestoneDto),
    assigneeIds: z.array(IdSchema),
  })
  .strict();
export type ProjectDto = z.infer<typeof ProjectDto>;
