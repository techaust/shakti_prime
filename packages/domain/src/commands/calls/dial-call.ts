import { DialCallInput, DialPlacementDto, DomainError, newId } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { dialFacts } from '../../queries/calls/dial-plan';
import { dialPhoneTaken } from '../../queries/calls/provider-calls';
import { callPurpose } from '../../telecom/call-purpose';
import { dndIsFresh, planDial, type DialFacts, type DndState } from '../../telecom/dial-plan';
import { requireEntity } from '../crm/opportunity-shared';
import { toProviderCallDto } from './provider-calls';

/** A dial pressed again this soon after one the provider has not finished taking is refused. */
export const DIAL_REPEAT_SECONDS = 60;

/**
 * The DND state the dial is checked on, as recorded: a service call takes the record as it is
 * (consent makes it lawful whatever the register says); a promotional call needs a check newer
 * than `WORKSHOP_DEFAULTS.calling.dndFreshDays`, else the state is unknown and the dial refused
 * (`dnd_unknown`). The dialler refreshes a stale check through the platform before it runs this
 * command (`prepareDial`), so the record here is that fresh answer.
 */
export function recordedDndState(facts: DialFacts, now: Date): DndState {
  const checkedAt = facts.phoneDndCheckedAt;
  if (checkedAt !== null) {
    const recorded: DndState = { kind: 'recorded', onDnd: facts.phoneIsDnd, checkedAt };
    if (callPurpose(facts).purpose === 'service' || dndIsFresh(checkedAt, now)) return recorded;
  }
  return { kind: 'unknown', checkedAt };
}

/** The caller's own phone that click-to-dial rings first, in the lead's company. */
async function ownDialPhone(ctx: CommandContext, entityId: number): Promise<string> {
  const cp = schema.callerProfiles;
  const [row] = await ctx.tx
    .select({ phone: cp.dialPhoneE164 })
    .from(cp)
    .where(and(eq(cp.userId, ctx.principal.id), eq(cp.entityId, entityId)))
    .limit(1);
  if (row?.phone == null) {
    throw new DomainError('validation_failed', 'the caller has no dial phone', {
      reason: 'dial_phone_missing',
    });
  }
  return row.phone;
}

/**
 * The caller's own phone must be theirs: never a customer's number nor a company's (set as one
 * before such a number was added), and never the number being called. Checked at every dial, not
 * only when the phone is set.
 */
async function refuseForeignDialPhone(
  ctx: CommandContext,
  agentNumber: string,
  customerNumber: string,
): Promise<void> {
  if (agentNumber === customerNumber || (await dialPhoneTaken(ctx, agentNumber))) {
    throw new DomainError('validation_failed', "the dial phone is not the caller's own", {
      reason: 'dial_phone_not_own',
    });
  }
}

/**
 * A double press: the caller's own call of the last minute that the provider has not yet taken
 * or rung. The caller's dials wait for each other on a lock held to the end of the transaction, so
 * two presses at once see each other: the second finds the first's row and is refused.
 */
async function refuseRepeat(ctx: CommandContext): Promise<void> {
  await ctx.tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`calls.dial:${ctx.principal.id}`}, 0))`,
  );
  const pc = schema.providerCalls;
  const [row] = await ctx.tx
    .select({ id: pc.id })
    .from(pc)
    .where(
      and(
        eq(pc.callerId, ctx.principal.id),
        gt(pc.startedAt, new Date(ctx.now.getTime() - DIAL_REPEAT_SECONDS * 1000)),
        inArray(pc.status, ['dialling', 'ringing']),
      ),
    )
    .limit(1);
  if (row !== undefined) {
    throw new DomainError('conflict', 'a call of the caller is still being placed', {
      reason: 'dial_in_progress',
    });
  }
}

/**
 * `calls.call.dial` (docs/03-roadmap-appendix/phase2.md §6.3, PRD TEL-01 and TEL-04), under the
 * permission `calls.dial`, for people only: a person's click-to-dial call to one phone of a lead's
 * customer (its main number when none is named). The facts come from `app.dial_facts()`, read as
 * the caller, which refuses a lead they cannot read; the purpose (`callPurpose`) picks the
 * company's 160-series number for a consented service call and the 140-series otherwise, and
 * `checkDial` refuses a call outside calling hours, to a mobile on DND or of unknown DND state for
 * a promotional call, to anyone who withdrew consent to calls, without consent for a service
 * call, or without the company's number for the purpose: every broken rule is listed
 * (`dial_refused`, `refusals`) and nothing is written. The caller must have set their own dial
 * phone (`dial_phone_missing`), one that is a customer's or a company's number or the number
 * called (`dial_phone_not_own`), and a second press while their last call is still being placed,
 * even at the same moment, is refused (`dial_in_progress`).
 *
 * An allowed dial is recorded as `dialling` and answered with what the provider is to be asked:
 * the caller's phone, the customer's, the company's number and the facts the provider adapter
 * checks again. The dialler (`placeDial`) asks the provider after this commits, so a call is
 * never placed for a dial that did not commit; the answer stays on the server.
 */
export const dialCall = defineCommand({
  name: 'calls.call.dial',
  permission: 'calls.dial',
  minScope: 'own',
  peopleOnly: true,
  input: DialCallInput,
  output: DialPlacementDto,
  auditFields: ['callPurpose', 'numberSeries', 'callStatus'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const facts = await dialFacts(ctx, input);
    const plan = planDial(facts, ctx.now, recordedDndState(facts, ctx.now));
    if (!plan.decision.allowed) {
      throw new DomainError('conflict', 'the dial breaks a calling rule', {
        reason: 'dial_refused',
        refusals: plan.decision.refusals,
      });
    }
    const { callerId, series } = plan;
    // checkDial refuses a missing number and one of the wrong series, so both are set here.
    if (callerId === null || (series !== '140' && series !== '160')) {
      throw new DomainError('internal', 'an allowed dial has the company number of its purpose');
    }
    const agentNumber = await ownDialPhone(ctx, input.entityId);
    await refuseForeignDialPhone(ctx, agentNumber, facts.phoneE164);
    await refuseRepeat(ctx);

    const [row] = await ctx.tx
      .insert(schema.providerCalls)
      .values({
        id: newId(),
        entityId: input.entityId,
        opportunityId: input.opportunityId,
        contactPhoneId: facts.contactPhoneId,
        callerId: ctx.principal.id,
        direction: 'outbound',
        series,
        purpose: plan.purpose,
        status: 'dialling',
        startedAt: ctx.now,
      })
      .returning();
    if (!row) throw new DomainError('internal', 'provider call insert returned no row');
    ctx.audit({
      aggregateType: 'provider_call',
      aggregateId: row.id,
      entityId: row.entityId,
      after: {
        opportunityId: row.opportunityId,
        callPurpose: plan.purpose,
        numberSeries: series,
        callStatus: row.status,
      },
    });
    const onDnd =
      plan.dnd.kind === 'recorded' || plan.dnd.kind === 'refreshed' ? plan.dnd.onDnd : false;
    return {
      call: toProviderCallDto(row),
      placement: {
        agentNumber,
        customerNumber: facts.phoneE164,
        callerId,
        purpose: plan.purpose,
        hasRecordedConsent: facts.hasServiceConsent,
        onDnd,
        callConsentWithdrawn: facts.callConsentWithdrawn,
      },
    };
  },
});
