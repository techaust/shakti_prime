import {
  DialPlanDto,
  DialPlanInput,
  DomainError,
  LeadChannelSchema,
  type RecordPhoneDndInput,
} from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import { sql } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import type { DialFacts, DialPlan } from '../../telecom/dial-plan';

interface FactsRow {
  entity_id: number;
  source_channel: string | null;
  has_open_callback: boolean;
  has_order: boolean;
  phone_e164: string;
  phone_is_dnd: boolean;
  phone_dnd_checked_at: Date | string | null;
  has_service_consent: boolean;
  call_consent_withdrawn: boolean;
  promo_number: string | null;
  service_number: string | null;
}

/**
 * What `checkDial` needs for a call to one phone of a lead's customer (`app.dial_facts()`), for a
 * person holding `calls.dial` who reads the lead. A lead the caller cannot read, of another
 * company, or a phone that is not a contact's of its customer is not found.
 */
export async function dialFacts(
  ctx: Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>,
  rawInput: DialPlanInput,
): Promise<DialFacts> {
  const input = DialPlanInput.parse(rawInput);
  checkPermission(ctx.principal, 'calls.dial', 'own');
  if (!ctx.entityIds.includes(input.entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', {
      entityId: input.entityId,
    });
  }
  const rows = (await ctx.tx.execute(
    sql`select * from app.dial_facts(${input.opportunityId}::uuid, ${input.contactPhoneId}::uuid)`,
  )) as unknown as FactsRow[];
  const [row] = rows;
  if (!row || row.entity_id !== input.entityId) {
    throw new DomainError('not_found', `lead ${input.opportunityId} is not visible`, {
      reason: 'lead_missing',
    });
  }
  const source = LeadChannelSchema.safeParse(row.source_channel);
  return {
    entityId: row.entity_id,
    sourceChannel: source.success ? source.data : null,
    hasOpenCallback: row.has_open_callback,
    hasOrder: row.has_order,
    phoneE164: row.phone_e164,
    phoneIsDnd: row.phone_is_dnd,
    phoneDndCheckedAt:
      row.phone_dnd_checked_at === null ? null : new Date(row.phone_dnd_checked_at),
    hasServiceConsent: row.has_service_consent,
    callConsentWithdrawn: row.call_consent_withdrawn,
    promoNumber: row.promo_number,
    serviceNumber: row.service_number,
  };
}

/** The plan as the workspaces show it. */
export function toDialPlanDto(contactPhoneId: string, plan: DialPlan): DialPlanDto {
  const refusals = plan.decision.allowed ? [] : plan.decision.refusals;
  return DialPlanDto.parse({
    contactPhoneId,
    purpose: plan.purpose,
    purposeReason: plan.purposeReason,
    callerId: plan.callerId,
    series: plan.series,
    dnd: plan.dnd.kind,
    onDnd: plan.dnd.kind === 'unknown' ? null : plan.dnd.onDnd,
    dndCheckedAt: plan.dnd.checkedAt?.toISOString() ?? null,
    allowed: plan.decision.allowed,
    refusals,
  });
}

/** The platform's record of a register answer for the phone a plan looked up. */
export function dndRecordInput(
  facts: DialFacts,
  contactPhoneId: string,
  answer: { onDnd: boolean; checkedAt: Date },
): RecordPhoneDndInput {
  return {
    entityId: facts.entityId,
    contactPhoneId,
    e164: facts.phoneE164,
    onDnd: answer.onDnd,
    checkedAt: answer.checkedAt.toISOString(),
  };
}
