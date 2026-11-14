import {
  DialCallInput,
  DomainError,
  type Principal,
  type ProviderCallDto,
} from '@shakti/contracts';
import { executeCommand, executeQuery, type ExecuteOptions } from '../command/execute';
import { dialCall } from '../commands/calls/dial-call';
import { recordProviderCall } from '../commands/calls/provider-calls';
import { recordPhoneDnd } from '../commands/crm/record-phone-dnd';
import {
  ClickToDialNotSetUp,
  ClickToDialUncertain,
  type ClickToDial,
} from '../ports/click-to-dial';
import type { DndRegistry } from '../ports/dnd';
import { jsonLogger, type Logger } from '../ports/logger';
import { dialFacts, dndRecordInput } from '../queries/calls/dial-plan';
import { prepareDial } from '../telecom/dial-plan';

// Click-to-dial from press to provider (docs/03-roadmap-appendix/phase2.md §6.3): the dial is
// planned as the caller (refreshing a stale DND check through the platform), recorded by
// `calls.call.dial`, which checks every calling rule again in its own transaction, and only after
// that commits is the provider asked to place it. A refused dial never reaches the provider. The
// provider's id is recorded by the platform (`calls.process`); its status reports settle the rest.

export interface PlaceDialDeps {
  /** The DND register a stale check of a promotional call is refreshed from. */
  registry: DndRegistry;
  /** The provider; undefined when this runtime has none (production until the final phase). */
  dialler: ClickToDial | undefined;
  /** `system:workers` for a company: records the DND answer and the provider's id. */
  workers: (entityId: number) => Principal;
  requestId: string;
  hosted: boolean;
  /** The clock the calling rules are checked on; the journeys and tests pass their own. */
  now?: Date;
  /**
   * The person's own command options (the request's client, the publisher's nudge). Never an
   * idempotency key: the dial's answer carries the phones, which a stored answer would keep, and
   * a repeated press is refused by the command itself (`dial_in_progress`).
   */
  options?: Omit<ExecuteOptions, 'now' | 'hosted' | 'idempotencyKey' | 'idempotency'>;
  logger?: Logger;
}

/**
 * Places a person's click-to-dial call and answers it as recorded. Refused with every broken
 * rule (`dial_refused`, `refusals`) before anything is written when the plan breaks a calling
 * rule; `calling_not_set_up` when the runtime has no provider; `dial_failed` when the provider
 * refused it, after the call is recorded as failed. A provider that did not answer in time leaves
 * the call dialling, never placed again: the phones may still ring, and its status report settles it.
 */
export async function placeDial(
  principal: Principal,
  rawInput: DialCallInput,
  deps: PlaceDialDeps,
): Promise<ProviderCallDto> {
  const input = DialCallInput.parse(rawInput);
  const logger = deps.logger ?? jsonLogger();
  const now = deps.now ?? new Date();
  const scope = { entityIds: [input.entityId], requestId: deps.requestId };
  const facts = await executeQuery(principal, scope, (context) => dialFacts(context, input), {
    name: 'calls.call.dial.facts',
  });
  const plan = await prepareDial(facts, now, {
    registry: deps.registry,
    record: async (answer) => {
      await executeCommand(
        deps.workers(facts.entityId),
        scope,
        recordPhoneDnd,
        dndRecordInput(facts, facts.contactPhoneId, answer),
        { hosted: deps.hosted },
      );
    },
  });
  if (!plan.decision.allowed) {
    throw new DomainError('conflict', 'the dial breaks a calling rule', {
      reason: 'dial_refused',
      refusals: plan.decision.refusals,
    });
  }
  const dialler = deps.dialler;
  if (dialler === undefined) {
    throw new DomainError('integration_unavailable', 'no telephony provider is set up', {
      reason: 'calling_not_set_up',
    });
  }

  const dialled = await executeCommand(
    principal,
    scope,
    dialCall,
    { ...input, contactPhoneId: facts.contactPhoneId },
    { ...deps.options, hosted: deps.hosted, now },
  );
  const call = dialled.call;
  const record = (status: 'ringing' | 'failed', callSid?: string) =>
    executeCommand(
      deps.workers(call.entityId),
      scope,
      recordProviderCall,
      {
        entityId: call.entityId,
        providerCallId: call.id,
        status,
        ...(callSid === undefined ? {} : { callSid }),
        ...(status === 'failed' ? { endedAt: now.toISOString() } : {}),
      },
      { hosted: deps.hosted },
    );

  let sid: string;
  try {
    ({ sid } = await dialler.place({ ...dialled.placement, ref: call.id, record: true }));
  } catch (e) {
    if (e instanceof ClickToDialUncertain) {
      logger.log('warn', 'calls.dial.uncertain', {
        providerCallId: call.id,
        requestId: deps.requestId,
      });
      return call;
    }
    await record('failed').catch((recordError: unknown) => {
      logger.log('error', 'calls.dial.record_failed', {
        providerCallId: call.id,
        requestId: deps.requestId,
        error: recordError instanceof Error ? recordError.name : 'unknown',
      });
    });
    const notSetUp = e instanceof ClickToDialNotSetUp;
    throw new DomainError(
      'integration_unavailable',
      notSetUp ? 'no telephony provider is set up' : 'the provider did not place the call',
      { reason: notSetUp ? 'calling_not_set_up' : 'dial_failed' },
      { cause: e },
    );
  }
  try {
    const recorded = await record('ringing', sid);
    return { ...call, status: recorded.status ?? call.status };
  } catch (e) {
    // The call is placed; its status report carries the provider's id and settles it.
    logger.log('error', 'calls.dial.record_failed', {
      providerCallId: call.id,
      requestId: deps.requestId,
      error: e instanceof Error ? e.name : 'unknown',
    });
    return call;
  }
}
