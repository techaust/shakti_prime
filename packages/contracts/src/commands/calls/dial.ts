import { z } from 'zod';
import { E164Schema } from '../../crm/phone';
import { EntityIdSchema, IdSchema } from '../../ids';

/**
 * The dial rules in code (BLUEPRINT §7.7, PRD TEL-04 and CRM-10, docs/03-roadmap-appendix/phase2.md
 * §5.2): what the platform records of the DND register, and the plan the Cold Caller and
 * Converting workspaces show for a call before it is placed.
 */

/**
 * `crm.phone.dnd_record`: the platform records what the DND register answered for one phone of a
 * customer, for the number it asked about, checked at `checkedAt`. Run as `system:workers` with the
 * platform-only `crm.dnd.record`, never by a person.
 */
export const RecordPhoneDndInput = z
  .object({
    entityId: EntityIdSchema,
    contactPhoneId: IdSchema,
    e164: E164Schema,
    onDnd: z.boolean(),
    checkedAt: z.iso.datetime(),
  })
  .strict();
export type RecordPhoneDndInput = z.input<typeof RecordPhoneDndInput>;

/** The phone's DND state as it now stands: a newer answer already recorded is kept. */
export const PhoneDndDto = z
  .object({
    contactPhoneId: IdSchema,
    isDnd: z.boolean(),
    dndCheckedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type PhoneDndDto = z.infer<typeof PhoneDndDto>;

/** A call to one phone of a lead's customer, to plan. */
export const DialPlanInput = z
  .object({
    entityId: EntityIdSchema,
    opportunityId: IdSchema,
    contactPhoneId: IdSchema,
  })
  .strict();
export type DialPlanInput = z.input<typeof DialPlanInput>;

export const CALL_PURPOSES = ['promotional', 'service'] as const;

/** Why the call is service or promotional (`call-purpose.ts`). */
export const DIAL_PURPOSE_REASONS = [
  'service_order',
  'service_callback',
  'service_enquiry',
  'promotional_no_consent',
  'promotional_not_requested',
] as const;

/** Every rule a dial can break, in the order they are listed (`checkDial`). */
export const DIAL_REFUSAL_REASONS = [
  'outside_calling_hours',
  'recipient_not_a_mobile_number',
  'call_consent_withdrawn',
  'company_number_missing',
  'caller_id_not_promotional',
  'caller_id_not_service',
  'service_call_without_consent',
  'recipient_on_dnd',
  'dnd_unknown',
] as const;

/** Where the DND state came from: as recorded, looked up just now, or not to be had. */
export const DND_STATE_KINDS = ['recorded', 'refreshed', 'unknown'] as const;

/**
 * The plan for a call: its purpose and why, the company's number it would go out on (null when
 * the company has none for the purpose) and its series, the DND state used, and every rule it
 * would break. `allowed` is true only when `refusals` is empty.
 */
export const DialPlanDto = z
  .object({
    contactPhoneId: IdSchema,
    purpose: z.enum(CALL_PURPOSES),
    purposeReason: z.enum(DIAL_PURPOSE_REASONS),
    callerId: E164Schema.nullable(),
    series: z.enum(['140', '160', 'other']).nullable(),
    dnd: z.enum(DND_STATE_KINDS),
    onDnd: z.boolean().nullable(),
    dndCheckedAt: z.iso.datetime().nullable(),
    allowed: z.boolean(),
    refusals: z.array(z.enum(DIAL_REFUSAL_REASONS)),
  })
  .strict();
export type DialPlanDto = z.infer<typeof DialPlanDto>;
