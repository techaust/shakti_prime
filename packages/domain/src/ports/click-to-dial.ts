import type { CallPurpose } from '../telecom/dial-policy';

/**
 * The telephony provider's click-to-dial (Exotel, docs/03-roadmap-appendix/phase2.md §6.3): ring the
 * caller's own phone first and, when they answer, the customer's, showing the company's number for
 * the call's purpose, recording on, and reporting to the call's signed status address. The dial
 * command decides everything before it asks: a refused dial never reaches a port. The adapter
 * (`apps/web/src/integrations/exotel`) checks the calling rules once more before it sends.
 */
export interface ClickToDialRequest {
  /** The BOS's id of the provider call; the adapter signs the status address with it. */
  ref: string;
  /** The caller's own phone, rung first. */
  agentNumber: string;
  /** The customer's phone. */
  customerNumber: string;
  /** The company's number for the purpose: 140-series for promotional, 160-series for service. */
  callerId: string;
  purpose: CallPurpose;
  hasRecordedConsent: boolean;
  onDnd: boolean;
  callConsentWithdrawn: boolean;
  record: boolean;
}

/** The provider took the call: its own id for it. */
export interface PlacedProviderCall {
  sid: string;
}

/** The provider refused the call outright: nothing rang. */
export class ClickToDialRefused extends Error {
  constructor(message = 'the provider refused the call') {
    super(message);
    this.name = 'ClickToDialRefused';
  }
}

/**
 * The provider did not answer in time or the line dropped: the phones may still ring, so the call
 * is left as it is for the status report to settle, and never placed again.
 */
export class ClickToDialUncertain extends Error {
  constructor(message = 'the provider did not answer in time') {
    super(message);
    this.name = 'ClickToDialUncertain';
  }
}

/** This runtime has no provider account (production until the final phase, question 13). */
export class ClickToDialNotSetUp extends Error {
  constructor(message = 'no telephony provider is set up') {
    super(message);
    this.name = 'ClickToDialNotSetUp';
  }
}

export interface ClickToDial {
  place(request: ClickToDialRequest): Promise<PlacedProviderCall>;
}

/**
 * A fake provider for the tests and the journeys: it answers every call with a new id and keeps
 * what it was asked, or fails each call in the way `fail` names.
 */
export function fakeClickToDial(
  options: { fail?: 'refused' | 'uncertain' | 'not_set_up'; sid?: (n: number) => string } = {},
): ClickToDial & { placed: ClickToDialRequest[] } {
  const placed: ClickToDialRequest[] = [];
  return {
    placed,
    place(request) {
      placed.push(request);
      switch (options.fail) {
        case 'refused':
          return Promise.reject(new ClickToDialRefused());
        case 'uncertain':
          return Promise.reject(new ClickToDialUncertain());
        case 'not_set_up':
          return Promise.reject(new ClickToDialNotSetUp());
        default:
          return Promise.resolve({
            sid: options.sid?.(placed.length) ?? `fake${request.ref.replaceAll('-', '')}`,
          });
      }
    },
  };
}

/** A provider that must never be reached: any call fails the test that uses it. */
export function unreachableClickToDial(): ClickToDial & { calls: number } {
  const port = {
    calls: 0,
    place(): Promise<PlacedProviderCall> {
      port.calls += 1;
      return Promise.reject(new Error('the provider was reached'));
    },
  };
  return port;
}
