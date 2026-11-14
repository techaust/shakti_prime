import { newId } from '@shakti/contracts';
import {
  ClickToDialRefused,
  ClickToDialUncertain,
  type ClickToDial,
  type ClickToDialRequest,
} from '@shakti/domain';
import { hostedRuntime } from '../../auth/deps';
import { logger } from '../../log';
import { ProviderError } from '../http';
import { DialRefusedError, exotelClient, exotelConfig, type ExotelClient } from './client';
import { signedStatusCallbackUrl } from './status-callback';

/** Where Exotel posts a call's status: the webhook route of docs/06-api.md §3.4. */
export const STATUS_CALLBACK_PATH = '/api/v1/webhooks/exotel/call-status';

/** The longest call Exotel lets run, in seconds: the four hours a call log takes. */
const CALL_TIME_LIMIT_SECONDS = 4 * 60 * 60;

/**
 * Exotel behind the dial's port (docs/03-roadmap-appendix/phase2.md §6.3): the caller's phone is
 * rung first, then the customer's, showing the company's number, reporting to the call's own
 * signed status address, the BOS's call id echoed as `CustomField`. The client checks the
 * calling rules once more and never retries a dial.
 *
 * The call is placed unrecorded. The built client connects two numbers (Exotel's
 * `Calls/connect.json` with `From` and `To`), and that call has no flow before the caller is
 * joined in which the company's recording notice could play; Exotel can connect a number to a flow
 * instead, but that flow would then need a dynamic Connect applet asking the BOS which customer
 * to ring, which is not built. Until it is, the caller reads the notice, the first line of the
 * script card (design §6.3), and no recording is made.
 *
 * A refusal by the client's own rules or by Exotel (a 4xx) is `ClickToDialRefused`; a timeout, a
 * dropped line or an Exotel 5xx is `ClickToDialUncertain`, since the phones may still ring.
 */
export function exotelClickToDial(
  client: ExotelClient,
  callback: { base: string; secret: string },
  now: () => Date = () => new Date(),
): ClickToDial {
  return {
    async place(request: ClickToDialRequest) {
      const statusCallbackUrl = signedStatusCallbackUrl(
        new URL(STATUS_CALLBACK_PATH, callback.base).toString(),
        request.ref,
        callback.secret,
        now(),
      );
      try {
        const placed = await client.connectCall({
          agentNumber: request.agentNumber,
          customerNumber: request.customerNumber,
          callerId: request.callerId,
          purpose: request.purpose,
          hasRecordedConsent: request.hasRecordedConsent,
          onDnd: request.onDnd,
          callConsentWithdrawn: request.callConsentWithdrawn,
          statusCallbackUrl,
          record: false,
          timeLimitSeconds: CALL_TIME_LIMIT_SECONDS,
          customField: request.ref,
        });
        return { sid: placed.sid };
      } catch (error) {
        if (error instanceof DialRefusedError) throw new ClickToDialRefused(error.message);
        if (
          error instanceof ProviderError &&
          error.failure === 'http' &&
          error.status !== undefined &&
          error.status < 500
        ) {
          throw new ClickToDialRefused(error.message);
        }
        throw new ClickToDialUncertain(error instanceof Error ? error.message : undefined);
      }
    },
  };
}

/** A report the simulated provider sends, as Exotel would post it to the status address. */
export type SimulatedReport = (report: Record<string, unknown>) => Promise<void>;

/** Exotel's time format, India time, for the simulated reports. */
function exotelTime(at: Date): string {
  return new Date(at.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * The provider a developer's machine and the journeys use (never a hosted runtime): it takes every
 * call, and, as Exotel would, reports the customer answering after `answerMs` and the call ending
 * after `endMs`, through the same status handler a real report reaches. Nothing rings.
 */
export function simulatedClickToDial(
  report: SimulatedReport,
  options: { answerMs?: number; endMs?: number; now?: () => Date } = {},
): ClickToDial {
  const now = options.now ?? (() => new Date());
  const answerMs = options.answerMs ?? 1_500;
  const endMs = options.endMs ?? 4_500;
  return {
    place(request) {
      const sid = `sim${newId().replaceAll('-', '')}`;
      const send = (status: 'in-progress' | 'completed', delayMs: number) => {
        setTimeout(() => {
          const at = now();
          void report({
            CallSid: sid,
            Status: status,
            DateUpdated: exotelTime(at),
            ...(status === 'completed'
              ? {
                  EndTime: exotelTime(at),
                  ConversationDuration: String(Math.round((endMs - answerMs) / 1000)),
                  RecordingUrl: '',
                }
              : {}),
            CustomField: request.ref,
            bos_ref: request.ref,
          }).catch((error: unknown) => {
            logger.log('warn', 'calls.simulated_report_failed', { providerCallId: request.ref, error });
          });
        }, delayMs);
      };
      send('in-progress', answerMs);
      send('completed', endMs);
      return Promise.resolve({ sid });
    },
  };
}

/**
 * The provider this runtime dials through: Exotel when its account, the callback secret and the
 * app's address are set; on a developer's machine and in the journeys without them, the simulated
 * provider; on a hosted runtime without them (production until the final phase, question 13),
 * none, so the workspaces keep the manual flow.
 */
export function clickToDial(
  report: SimulatedReport,
  options: { env?: NodeJS.ProcessEnv; now?: () => Date } = {},
): ClickToDial | undefined {
  const env = options.env ?? process.env;
  const config = exotelConfig(env);
  const secret = env.EXOTEL_CALLBACK_SECRET ?? '';
  const base = env.BETTER_AUTH_URL ?? '';
  if (config !== undefined && secret !== '' && base !== '') {
    return exotelClickToDial(exotelClient(config), { base, secret });
  }
  if (hostedRuntime(env)) return undefined;
  return simulatedClickToDial(report, options.now === undefined ? {} : { now: options.now });
}
