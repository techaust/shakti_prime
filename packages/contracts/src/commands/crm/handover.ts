import { z } from 'zod';
import { CustomerLanguageSchema, SegmentSchema } from '../../crm/enums';
import { EntityIdSchema, IdSchema } from '../../ids';

// The handover of qualified leads (PRD TEL-02, docs/03-roadmap-appendix/phase1.md §8.2): a caller's
// profile, the people who take part in the round-robin, and the commands that give leads over.

/** Whether a person takes new leads from the handover now. */
export const CALLER_PRESENCE = ['present', 'away'] as const;
export const CallerPresenceSchema = z.enum(CALLER_PRESENCE);
export type CallerPresence = z.infer<typeof CallerPresenceSchema>;

/** The most open leads a profile may cap at; null takes any number. */
export const MAX_OPEN_LIMIT = 1000;

/** `crm.caller_profile.set`: a person's part in the handover in one company. */
export const SetCallerProfileInput = z
  .object({
    entityId: EntityIdSchema,
    userId: IdSchema,
    isConverter: z.boolean(),
    maxOpen: z.number().int().min(1).max(MAX_OPEN_LIMIT).nullable(),
    /** An empty list takes every language. */
    languages: z.array(CustomerLanguageSchema).max(2),
    /** An empty list takes every business line. */
    segments: z.array(SegmentSchema).max(4),
  })
  .strict();
export type SetCallerProfileInput = z.infer<typeof SetCallerProfileInput>;

/** `crm.caller_profile.set_presence`: the caller's own presence in one company. */
export const SetPresenceInput = z
  .object({ entityId: EntityIdSchema, presence: CallerPresenceSchema })
  .strict();
export type SetPresenceInput = z.infer<typeof SetPresenceInput>;

/** A profile as the commands answer it. Strict. */
export const CallerProfileDto = z
  .object({
    userId: IdSchema,
    entityId: EntityIdSchema,
    isConverter: z.boolean(),
    presence: CallerPresenceSchema,
    maxOpen: z.number().int().nullable(),
    languages: z.array(CustomerLanguageSchema),
    segments: z.array(SegmentSchema),
  })
  .strict();
export type CallerProfileDto = z.infer<typeof CallerProfileDto>;

/** One person on the converters page: who they are and their profile. Strict. */
export const CallerProfilePersonDto = z
  .object({
    userId: IdSchema,
    name: z.string(),
    teamId: IdSchema.nullable(),
    roleKey: z.string(),
    isConverter: z.boolean(),
    presence: CallerPresenceSchema,
    maxOpen: z.number().int().nullable(),
    languages: z.array(CustomerLanguageSchema),
    segments: z.array(SegmentSchema),
  })
  .strict();
export type CallerProfilePersonDto = z.infer<typeof CallerProfilePersonDto>;

/**
 * `crm.lead.reassign_all`: every open and nurtured lead of a leaving caller in one company goes to
 * one named person (`toUserId`), or in turn to the converters who qualify (`toUserId` null).
 */
export const ReassignAllInput = z
  .object({ entityId: EntityIdSchema, fromUserId: IdSchema, toUserId: IdSchema.nullable() })
  .strict();
export type ReassignAllInput = z.infer<typeof ReassignAllInput>;

/**
 * What `crm.lead.reassign_all` answers: how many leads moved, how many of the leaver's leads the
 * caller can see are still with them (a run moves at most 500), and whether the caller's scope
 * is a team's, so leads outside the team stay where they are. Strict.
 */
export const ReassignAllDto = z
  .object({
    entityId: EntityIdSchema,
    moved: z.number().int().min(0),
    remaining: z.number().int().min(0),
    teamOnly: z.boolean(),
  })
  .strict();
export type ReassignAllDto = z.infer<typeof ReassignAllDto>;

/**
 * `crm.opportunity.hand_over`, run by the handover worker for a `crm.opportunity.stage_moved`
 * event with `handover: true`. `cursor` is the person the round-robin chose last in the company
 * (kept in Redis by the worker), null when there is none. `stageId` is the stage the event moved
 * the lead to and `eventAt` the time of the event: a lead that has left the stage, is locked, or
 * was given to someone after the event is left alone.
 */
export const HandOverLeadInput = z
  .object({
    entityId: EntityIdSchema,
    opportunityId: IdSchema,
    eventId: IdSchema,
    stageId: IdSchema,
    eventAt: z.string().datetime(),
    cursor: IdSchema.nullable(),
  })
  .strict();
export type HandOverLeadInput = z.infer<typeof HandOverLeadInput>;

/** How a handover ended; `already`, `not_open` and `kept` changed nothing. */
export const HANDOVER_OUTCOMES = [
  'converter',
  'team_lead',
  'already',
  'not_open',
  'kept',
  'no_one',
] as const;
export const HandOverLeadDto = z
  .object({
    outcome: z.enum(HANDOVER_OUTCOMES),
    ownerId: IdSchema.nullable(),
    /** The cursor to keep: the converter chosen, else the one it was. */
    cursor: IdSchema.nullable(),
  })
  .strict();
export type HandOverLeadDto = z.infer<typeof HandOverLeadDto>;

/** The company a converters read is for: `listCallerProfiles` and `ownPresence`. */
export const CallerCompanyInput = z.object({ entityId: EntityIdSchema }).strict();
export type CallerCompanyInput = z.infer<typeof CallerCompanyInput>;
