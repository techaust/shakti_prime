import {
  isDomainError,
  normaliseIndianPhone,
  ProviderCallSidSchema,
  type ExotelIncomingWebhook,
  type PendingScreenPop,
} from '@shakti/contracts';
import {
  executeCommand,
  executeQuery,
  inboundCallLines,
  recordInboundCall,
  type KeyValue,
} from '@shakti/domain';
import { defaultAuthDeps } from '../../auth/deps';
import { holdRinging } from '../../calls/ringing';
import { logger } from '../../log';
import { systemWorkersPrincipal } from '../events/system-principal';
import { exotelInstant } from './exotel-status';
import type { WebhookHandled, WebhookHandlerContext } from './registry';

/** What the handler reads besides the call; tests pass their own. */
export interface ExotelIncomingDeps {
  /** The shared store the ringing call waits in for its person. */
  keyValue: () => KeyValue;
  now: () => Date;
}

const defaultDeps: ExotelIncomingDeps = {
  keyValue: () => defaultAuthDeps().keyValue,
  now: () => new Date(),
};

/**
 * The `exotel_incoming` handler (docs/03-roadmap-appendix/phase2.md §7.4), run by the webhook
 * worker for a call Exotel's Passthru applet passed through, as `system:workers` with the
 * platform-only `calls.process`:
 * 1. the company and the line are found by the number dialled (`CallTo`), its IVR or missed-call
 *    number (`app.inbound_call_lines()`); a number of no company is noted `call_number_unknown`,
 *    and one several companies share `call_number_shared`, and nothing is recorded;
 * 2. the call is recorded in that company (`calls.inbound_call.record`), keyed on its `CallSid`, so a
 *    repeated delivery changes nothing: on the IVR line ringing the person whose own dial phone is
 *    `DialWhomNumber`, with the company's customers holding the caller's number; on the
 *    missed-call line as a lead made or joined with a callback for its owner;
 * 3. an IVR call that rings a person is held for them a minute in the shared store
 *    (`ringing:<user id>`), which their screen-pop takes.
 * A delivery that cannot land a lead (the company offers no pipeline for it) is set aside with the
 * reason as its code. Logs carry ids and codes only, never a number.
 */
export function exotelIncomingHandler(deps: ExotelIncomingDeps = defaultDeps) {
  return async (
    payload: ExotelIncomingWebhook,
    context: Pick<WebhookHandlerContext, 'requestId'>,
  ): Promise<WebhookHandled> => {
    const { requestId } = context;
    const sid = ProviderCallSidSchema.safeParse(payload.CallSid);
    const dialled = normaliseIndianPhone(payload.CallTo);
    const from = normaliseIndianPhone(payload.CallFrom);
    if (!sid.success || dialled === null) return { entityId: null, code: 'call_unreadable' };
    const lines = await executeQuery(
      systemWorkersPrincipal(null),
      { entityIds: [], requestId },
      (ctx) => inboundCallLines(ctx, dialled),
      { name: 'calls.inbound.lines', pool: 'app_user' },
    );
    const [line] = lines;
    if (line === undefined) return { entityId: null, code: 'call_number_unknown' };
    if (lines.length > 1) {
      logger.log('warn', 'calls.inbound_number_shared', { requestId, lines: lines.length });
      return { entityId: null, code: 'call_number_shared' };
    }
    const entityId = line.entityId;
    // A withheld or unreadable caller's number makes no lead and pops nothing.
    if (from === null) return { entityId, code: 'caller_number_unreadable' };
    const dialWhom =
      payload.DialWhomNumber === undefined || payload.DialWhomNumber === ''
        ? null
        : normaliseIndianPhone(payload.DialWhomNumber);
    const startedAt = exotelInstant(payload.StartTime);
    let recorded;
    try {
      recorded = await executeCommand(
        systemWorkersPrincipal(entityId),
        { entityIds: [entityId], requestId },
        recordInboundCall,
        {
          entityId,
          series: line.series,
          callSid: sid.data,
          from,
          ...(dialWhom === null ? {} : { dialWhom }),
          ...(startedAt === undefined ? {} : { startedAt }),
        },
      );
    } catch (error) {
      const reason = isDomainError(error) ? error.details?.reason : undefined;
      if (
        isDomainError(error) &&
        error.code === 'validation_failed' &&
        typeof reason === 'string'
      ) {
        logger.log('error', 'calls.inbound_set_aside', { requestId, entityId, code: reason });
        return { entityId, code: reason, failed: true };
      }
      throw error;
    }
    if (recorded.outcome === 'other_company') {
      logger.log('warn', 'calls.inbound_other_company', { requestId, entityId });
      return { entityId, code: 'call_of_other_company' };
    }
    if (
      recorded.outcome === 'recorded' &&
      recorded.answererId !== null &&
      recorded.providerCallId !== null
    ) {
      const pop: PendingScreenPop = {
        providerCallId: recorded.providerCallId,
        entityId,
        accountIds: recorded.accountIds,
        phone: from,
        ringingAt: deps.now().toISOString(),
      };
      await holdRinging(deps.keyValue(), recorded.answererId, pop);
    }
    logger.log('info', 'calls.inbound_recorded', {
      requestId,
      entityId,
      providerCallId: recorded.providerCallId,
      series: line.series,
      outcome: recorded.outcome,
      customers: recorded.accountIds.length,
      rang: recorded.answererId !== null,
    });
    return { entityId };
  };
}

export const handleExotelIncoming = exotelIncomingHandler();
