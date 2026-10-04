import { z } from 'zod';
import { EntityIdSchema, IdSchema } from './ids';
import { AgentRoleKeySchema } from './roles';

// The agent runtime and the Agent Inbox (docs/design/phase1.md §7.1, BLUEPRINT §9.3, SECURITY §6).

/** How far an agent may go with one action type (BLUEPRINT §9.3). */
export const AGENT_AUTONOMY = ['suggest', 'needs_approval', 'automatic'] as const;
export const AgentAutonomySchema = z.enum(AGENT_AUTONOMY);
export type AgentAutonomy = z.infer<typeof AgentAutonomySchema>;

/**
 * How one agent run ended (`agent_runs.outcome`): it proposed an action, acted on its own, found
 * nothing to do, was stopped by a kill switch or its daily spend cap, found the model unavailable,
 * or failed.
 */
export const AGENT_RUN_OUTCOMES = [
  'proposed',
  'acted',
  'nothing_to_do',
  'switched_off',
  'cap_reached',
  'unavailable',
  'failed',
] as const;
export const AgentRunOutcomeSchema = z.enum(AGENT_RUN_OUTCOMES);
export type AgentRunOutcome = z.infer<typeof AgentRunOutcomeSchema>;

/** How a run's model work ended, as the runtime reports it to `agents.run.record`. */
export const AGENT_RUN_ENDINGS = [
  'completed',
  'switched_off',
  'cap_reached',
  'unavailable',
  'failed',
] as const;
export const AgentRunEndingSchema = z.enum(AGENT_RUN_ENDINGS);
export type AgentRunEnding = z.infer<typeof AgentRunEndingSchema>;

/** `agent_actions.state`, the `agent_action` machine. */
export const AGENT_ACTION_STATES = ['proposed', 'executed', 'approved', 'rejected'] as const;
export const AgentActionStateSchema = z.enum(AGENT_ACTION_STATES);
export type AgentActionState = z.infer<typeof AgentActionStateSchema>;

/** `inbox_items.kind`: an agent's suggestion, or work routed to a person. */
export const INBOX_ITEM_KINDS = ['agent_suggestion', 'routed_work'] as const;
export const InboxItemKindSchema = z.enum(INBOX_ITEM_KINDS);
export type InboxItemKind = z.infer<typeof InboxItemKindSchema>;

/** `inbox_items.state`, the `inbox_item` machine. */
export const INBOX_ITEM_STATES = ['open', 'done'] as const;
export const InboxItemStateSchema = z.enum(INBOX_ITEM_STATES);
export type InboxItemState = z.infer<typeof InboxItemStateSchema>;

/** What an inbox item is about. */
export const INBOX_SUBJECT_TYPES = ['opportunity', 'account'] as const;
export const InboxSubjectTypeSchema = z.enum(INBOX_SUBJECT_TYPES);
export type InboxSubjectType = z.infer<typeof InboxSubjectTypeSchema>;

/** An action type is the name of the command the action runs (`crm.task.create`). */
export const AgentActionTypeSchema = z
  .string()
  .regex(/^[a-z][a-z_]*(\.[a-z][a-z_]*){2,3}$/)
  .max(64);

/** What a run was for, as a code (`lead_triage`), never free text. */
export const AgentPurposeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/)
  .max(40);

/** A model id as the vendor names it. */
export const ModelIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9.-]*$/)
  .max(64);

/** Whole paise. A daily cap fits comfortably under a billion rupees. */
export const PaiseSchema = z.number().int().min(0).max(100_000_000_000);

const Count = z.number().int().min(0).max(100_000_000);

/** `agents.inbox.approve` and `agents.inbox.reject`: one open suggestion of the company. */
export const InboxItemRefInput = z.object({ entityId: EntityIdSchema, itemId: IdSchema }).strict();
export type InboxItemRefInput = z.infer<typeof InboxItemRefInput>;

/** An editable field of an action type, by name, with the value a person typed. */
export const InboxFieldNameSchema = z
  .string()
  .regex(/^[a-z][A-Za-z]*$/)
  .max(40);

/**
 * `agents.inbox.edit`: approve a suggestion with some of its fields changed; only the fields its
 * action type lets a person change, each checked again by the command it runs.
 */
export const EditInboxItemInput = z
  .object({
    entityId: EntityIdSchema,
    itemId: IdSchema,
    changes: z
      .record(InboxFieldNameSchema, z.string().max(200))
      .refine((c) => Object.keys(c).length > 0 && Object.keys(c).length <= 10),
  })
  .strict();
export type EditInboxItemInput = z.infer<typeof EditInboxItemInput>;

/** What a decision on an inbox item answers. */
export const InboxDecisionDto = z
  .object({
    itemId: IdSchema,
    actionId: IdSchema,
    state: z.enum(['approved', 'rejected']),
    edited: z.boolean(),
  })
  .strict();
export type InboxDecisionDto = z.infer<typeof InboxDecisionDto>;

/**
 * `agents.config.set`: one agent's autonomy, for every action type (`actionType` null) or one,
 * and its daily spend cap, for every company (`entityId` null, in a request for every company) or
 * one. A cap is set on the agent's row for every action type only; null clears a setting.
 */
export const SetAgentConfigInput = z
  .object({
    agent: AgentRoleKeySchema,
    actionType: AgentActionTypeSchema.nullable(),
    entityId: EntityIdSchema.nullable(),
    autonomy: AgentAutonomySchema.nullable(),
    dailySpendCapPaise: PaiseSchema.nullable(),
  })
  .strict()
  .refine((i) => i.actionType === null || i.dailySpendCapPaise === null, {
    path: ['dailySpendCapPaise'],
    message: 'spend_cap_per_agent',
  });
export type SetAgentConfigInput = z.infer<typeof SetAgentConfigInput>;

/**
 * `agents.killswitch.set`: stops (or lets run again) every agent (`agent` null) or one, in every
 * company (`entityId` null, in a request for every company) or one.
 */
export const SetKillSwitchInput = z
  .object({
    agent: AgentRoleKeySchema.nullable(),
    entityId: EntityIdSchema.nullable(),
    enabled: z.boolean(),
  })
  .strict();
export type SetKillSwitchInput = z.infer<typeof SetKillSwitchInput>;

/** One row of `agent_configs`. Strict. */
export const AgentConfigDto = z
  .object({
    id: IdSchema,
    agent: AgentRoleKeySchema.nullable(),
    actionType: AgentActionTypeSchema.nullable(),
    entityId: EntityIdSchema.nullable(),
    autonomy: AgentAutonomySchema.nullable(),
    dailySpendCapPaise: PaiseSchema.nullable(),
    enabled: z.boolean(),
  })
  .strict();
export type AgentConfigDto = z.infer<typeof AgentConfigDto>;

/** The action an agent proposes or takes: the command's input and what it is about. */
export const AgentProposalSchema = z
  .object({
    input: z.record(z.string(), z.unknown()),
    subjectType: InboxSubjectTypeSchema,
    subjectId: IdSchema,
    /** Who the inbox item is for; left out, anyone who acts on the company's inbox. */
    assigneeId: IdSchema.optional(),
    teamId: IdSchema.optional(),
  })
  .strict();
export type AgentProposal = z.infer<typeof AgentProposalSchema>;

/**
 * `agents.run.record`: an agent principal records one run for one action type, with what it cost
 * and, when the model work completed, the action it proposes or takes. No prompt or answer text.
 */
export const RecordAgentRunInput = z
  .object({
    entityId: EntityIdSchema,
    agent: AgentRoleKeySchema,
    purpose: AgentPurposeSchema,
    actionType: AgentActionTypeSchema,
    model: ModelIdSchema.nullable(),
    tokensIn: Count,
    tokensOut: Count,
    costPaise: PaiseSchema,
    durationMs: Count,
    ended: AgentRunEndingSchema,
    proposal: AgentProposalSchema.optional(),
  })
  .strict()
  .refine((i) => i.proposal === undefined || i.ended === 'completed', {
    path: ['proposal'],
    message: 'proposal_needs_completed_run',
  });
export type RecordAgentRunInput = z.infer<typeof RecordAgentRunInput>;

/** What `agents.run.record` answers. */
export const AgentRunDto = z
  .object({
    runId: IdSchema,
    outcome: AgentRunOutcomeSchema,
    actionId: IdSchema.nullable(),
    inboxItemId: IdSchema.nullable(),
  })
  .strict();
export type AgentRunDto = z.infer<typeof AgentRunDto>;

/** One editable field of a suggestion as the inbox shows it. */
export const InboxFieldDto = z
  .object({
    name: InboxFieldNameSchema,
    kind: z.enum(['date_time', 'text']),
    value: z.string().nullable(),
    /** For text: the longest value the command accepts. */
    maxLength: z.number().int().min(1).max(200).nullable(),
  })
  .strict();
export type InboxFieldDto = z.infer<typeof InboxFieldDto>;

/** An open inbox item as the Agent Inbox lists it. Strict. */
export const InboxItemDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    kind: InboxItemKindSchema,
    agent: AgentRoleKeySchema.nullable(),
    actionType: AgentActionTypeSchema.nullable(),
    autonomy: AgentAutonomySchema.nullable(),
    subjectType: InboxSubjectTypeSchema,
    subjectId: IdSchema,
    /** The customer's name when the caller reads the lead or customer; null otherwise. */
    subjectName: z.string().nullable(),
    assigneeId: IdSchema.nullable(),
    fields: z.array(InboxFieldDto),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type InboxItemDto = z.infer<typeof InboxItemDto>;

export const InboxPageDto = z
  .object({ items: z.array(InboxItemDto), nextCursor: z.string().nullable() })
  .strict();
export type InboxPageDto = z.infer<typeof InboxPageDto>;

/** The inbox's open items, for the count in the top bar: at most 100 are counted. */
export const INBOX_COUNT_LIMIT = 100;
export const InboxCountDto = z.object({ open: z.number().int().min(0) }).strict();
export type InboxCountDto = z.infer<typeof InboxCountDto>;

/** `listInbox`: the caller's open items, newest first, keyset by creation time and id. */
export const ListInboxInput = z
  .object({ cursor: z.string().max(200).optional(), limit: z.number().int().min(1).max(100) })
  .strict();
export type ListInboxInput = z.infer<typeof ListInboxInput>;

/** One action type of one agent on the agents screen. */
export const AgentActionTypeSettingDto = z
  .object({
    actionType: AgentActionTypeSchema,
    /** The autonomy set for this action type in the company or group, if any. */
    autonomy: AgentAutonomySchema.nullable(),
    /** What applies: this row, the agent's own default, or Suggest. */
    effectiveAutonomy: AgentAutonomySchema,
    decided: z.number().int().min(0),
    approvedUnedited: z.number().int().min(0),
    /** Whether the record allows Automatic (BLUEPRINT §9.3). */
    automaticEarned: z.boolean(),
  })
  .strict();

/** One agent on the agents screen, for the request's company or for the group. */
export const AgentSettingDto = z
  .object({
    agent: AgentRoleKeySchema,
    /** This agent's own switch at this level. */
    enabled: z.boolean(),
    /** Whether any switch (every agent, this agent, this company) stops it here. */
    stopped: z.boolean(),
    autonomy: AgentAutonomySchema.nullable(),
    dailySpendCapPaise: PaiseSchema.nullable(),
    spentTodayPaise: PaiseSchema,
    runsToday: z.number().int().min(0),
    actionTypes: z.array(AgentActionTypeSettingDto),
  })
  .strict();
export type AgentSettingDto = z.infer<typeof AgentSettingDto>;

/** The agents screen: every agent at one level (one company, or the group). */
export const AgentSettingsDto = z
  .object({
    entityId: EntityIdSchema.nullable(),
    /** The switch for every agent at this level. */
    allEnabled: z.boolean(),
    agents: z.array(AgentSettingDto),
  })
  .strict();
export type AgentSettingsDto = z.infer<typeof AgentSettingsDto>;
