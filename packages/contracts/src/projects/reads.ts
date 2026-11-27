import { z } from 'zod';
import { SubsidySchemeSchema } from '../crm/sizing';
import { EntityIdSchema, IdSchema } from '../ids';
import { ProjectFlowSchema, ProjectSegmentSchema, ProjectStateSchema } from './enums';
import { ProjectDto, ProjectTemplateDto, StepKeySchema } from './projects';

/**
 * The reads of the project screens (J1, docs/03-roadmap-appendix/phase4.md §6.1): `/projects`, the
 * project page, Account 360's projects, the order page's link and Settings › Project steps.
 */

/** `/projects`: one company's projects, newest change first, by state, owner, segment and step. */
export const ListProjectsInput = z
  .object({
    entityId: EntityIdSchema,
    state: ProjectStateSchema.optional(),
    segment: ProjectSegmentSchema.optional(),
    ownerId: IdSchema.optional(),
    /** Projects whose current step (the first open one) has this key. */
    step: StepKeySchema.optional(),
    cursor: z.string().max(512).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ListProjectsInput = z.input<typeof ListProjectsInput>;

export const ProjectRowDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    projectNo: z.string(),
    /** Read through `app.project_customers()`; null only for a customer since anonymised. */
    customerName: z.string().nullable(),
    village: z.string().nullable(),
    segment: ProjectSegmentSchema,
    scheme: SubsidySchemeSchema,
    flow: ProjectFlowSchema,
    state: ProjectStateSchema,
    ownerName: z.string().nullable(),
    stepKey: StepKeySchema.nullable(),
    stepTitle: z.string().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type ProjectRowDto = z.infer<typeof ProjectRowDto>;

export const ProjectPageDto = z
  .object({ items: z.array(ProjectRowDto), nextCursor: z.string().nullable() })
  .strict();
export type ProjectPageDto = z.infer<typeof ProjectPageDto>;

/** A person named on a project screen. */
export const ProjectPersonDto = z.object({ id: IdSchema, name: z.string() }).strict();
export type ProjectPersonDto = z.infer<typeof ProjectPersonDto>;

/** What the list's filters offer: the owners and the steps of the company's projects. */
export const ProjectFiltersDto = z
  .object({ owners: z.array(ProjectPersonDto), steps: z.array(StepKeySchema) })
  .strict();
export type ProjectFiltersDto = z.infer<typeof ProjectFiltersDto>;

export const ProjectFiltersInput = z.object({ entityId: EntityIdSchema }).strict();
export type ProjectFiltersInput = z.input<typeof ProjectFiltersInput>;

export const GetProjectInput = z.object({ entityId: EntityIdSchema, projectId: IdSchema }).strict();
export type GetProjectInput = z.input<typeof GetProjectInput>;

/** The project page: the project, its order and customer, and the people it names. */
export const ProjectViewDto = z
  .object({
    project: ProjectDto,
    soNo: z.string().nullable(),
    customerName: z.string().nullable(),
    village: z.string().nullable(),
    district: z.string().nullable(),
    /** The owner, the people on it and whoever marked a step done, by id. */
    people: z.array(ProjectPersonDto),
  })
  .strict();
export type ProjectViewDto = z.infer<typeof ProjectViewDto>;

/** Account 360's projects of a customer in one company. */
export const AccountProjectsInput = z
  .object({ entityId: EntityIdSchema, accountId: IdSchema })
  .strict();
export type AccountProjectsInput = z.input<typeof AccountProjectsInput>;

/** The order page's link: the order's project not cancelled, if any, and if the caller reads it. */
export const OrderProjectInput = z.object({ entityId: EntityIdSchema, orderId: IdSchema }).strict();
export type OrderProjectInput = z.input<typeof OrderProjectInput>;

export const OrderProjectDto = z
  .object({ id: IdSchema, projectNo: z.string(), state: ProjectStateSchema })
  .strict()
  .nullable();
export type OrderProjectDto = z.infer<typeof OrderProjectDto>;

/** Settings › Project steps: each segment's current checklist and how many versions it had. */
export const ProjectTemplatesInput = z.object({ entityId: EntityIdSchema }).strict();
export type ProjectTemplatesInput = z.input<typeof ProjectTemplatesInput>;

export const ProjectTemplatesDto = z
  .object({
    segments: z.array(
      z
        .object({
          segment: ProjectSegmentSchema,
          current: ProjectTemplateDto.nullable(),
          versions: z.number().int().min(0),
        })
        .strict(),
    ),
  })
  .strict();
export type ProjectTemplatesDto = z.infer<typeof ProjectTemplatesDto>;

/** The people a Project Manager may put on a project of one company. */
export const ProjectPeopleInput = z.object({ entityId: EntityIdSchema }).strict();
export type ProjectPeopleInput = z.input<typeof ProjectPeopleInput>;

export const ProjectPeopleDto = z
  .object({ people: z.array(ProjectPersonDto.extend({ roleKey: z.string() }).strict()) })
  .strict();
export type ProjectPeopleDto = z.infer<typeof ProjectPeopleDto>;
