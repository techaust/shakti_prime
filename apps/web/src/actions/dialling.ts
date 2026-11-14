'use server';

import {
  DialCallInput,
  DialReadinessInput,
  DomainError,
  newId,
  normaliseIndianPhone,
  PlayCallRecordingInput,
  ProviderCallRefInput,
  SetDialPhoneInput,
  type DialOutcomeDto,
  type DialPhoneDto,
  type DialReadinessDto,
  type ProviderCallDto,
  type RecordingAddressDto,
} from '@shakti/contracts';
import {
  dialReadiness as dialReadinessQuery,
  executeCommand,
  executeQuery,
  ownDialPhone as ownDialPhoneQuery,
  ownProviderCall,
  placeDial,
  playCallRecording,
  setDialPhone,
  toDialReadiness,
} from '@shakti/domain';
import { hostedRuntime } from '../auth/deps';
import { fileStore } from '../files/store';
import { dndRegistry } from '../integrations/dnd/registry';
import { clickToDial } from '../integrations/exotel/click-to-dial';
import { logger } from '../log';
import { systemWorkersPrincipal } from '../workers/events/system-principal';
import { WEBHOOK_CONTRACTS } from '../workers/webhooks/contracts';
import { handleExotelStatus } from '../workers/webhooks/exotel-status';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn, testNow } from './support';

/**
 * Click-to-dial (docs/03-roadmap-appendix/phase2.md §6.3): thin wrappers (docs/06-api.md §4) over
 * the dial, the call bar's reads, a recording's playback and the caller's own dial phone.
 */

/**
 * The simulated provider's reports (a developer's machine and the journeys only) reach the same
 * status handler a real report does, read by the same contract.
 */
async function simulatedReport(report: Record<string, unknown>): Promise<void> {
  const parsed = WEBHOOK_CONTRACTS.exotel_status.safeParse(report);
  if (!parsed.success) return;
  await handleExotelStatus(parsed.data, { requestId: newId() });
}

/** The provider for a request, its simulated reports running on the request's clock. */
async function dialler() {
  const at = await testNow();
  const shift = at === undefined ? 0 : at.getTime() - Date.now();
  return clickToDial(simulatedReport, { now: () => new Date(Date.now() + shift) });
}

/** Whether the workspace offers the Dial key on a lead of this company. */
export async function dialReadiness(rawInput: unknown): Promise<ActionResult<DialReadinessDto>> {
  return toResult('dialReadiness', async () => {
    const principal = await signedIn();
    const input = parseInput(DialReadinessInput, rawInput);
    const { requestId } = await requestMeta();
    const facts = await executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => dialReadinessQuery(context, input.entityId),
      { name: 'dialReadiness' },
    );
    return toDialReadiness(facts, (await dialler()) !== undefined);
  });
}

/**
 * `calls.call.dial` through the provider (`placeDial`): the call as placed, or every calling rule
 * it broke for the screen to list. No idempotency key: the command refuses a second press.
 */
export async function dialCall(rawInput: unknown): Promise<ActionResult<DialOutcomeDto>> {
  return toResult('dialCall', async () => {
    const principal = await signedIn();
    const input = parseInput(DialCallInput, rawInput);
    const meta = await requestMeta();
    const now = (await testNow()) ?? new Date();
    try {
      const call = await placeDial(principal, input, {
        registry: dndRegistry(),
        dialler: await dialler(),
        workers: systemWorkersPrincipal,
        requestId: meta.requestId,
        hosted: hostedRuntime(),
        now,
        // The caller's address and the outbox nudge; never a key (`commandOptions` takes none here).
        options: commandOptions(meta),
        logger,
      });
      return { kind: 'placed', call };
    } catch (e) {
      const refusals = e instanceof DomainError ? e.details?.refusals : undefined;
      if (e instanceof DomainError && e.details?.reason === 'dial_refused' && Array.isArray(refusals)) {
        return { kind: 'refused', refusals } as DialOutcomeDto;
      }
      throw e;
    }
  });
}

/** The caller's own call as it now stands, for the call bar. */
export async function providerCallStatus(rawInput: unknown): Promise<ActionResult<ProviderCallDto>> {
  return toResult('providerCallStatus', async () => {
    const principal = await signedIn();
    const input = parseInput(ProviderCallRefInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => ownProviderCall(context, input),
      { name: 'providerCallStatus' },
    );
  });
}

/**
 * `calls.recording.play`: a 15-minute address that plays the recording, for a listener whose scope
 * covers the call's lead. Each listen is audited by the command.
 */
export async function playRecording(rawInput: unknown): Promise<ActionResult<RecordingAddressDto>> {
  return toResult('playRecording', async () => {
    const principal = await signedIn();
    const input = parseInput(PlayCallRecordingInput, rawInput);
    const meta = await requestMeta();
    const store = fileStore();
    if (store === undefined) {
      throw new DomainError('integration_unavailable', 'no file store', { reason: 'recording_missing' });
    }
    const stored = await executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      playCallRecording,
      input,
      { client: meta.client },
    );
    // Signed by the store that holds the recording's bucket; one kept elsewhere is not played here.
    if (stored.bucket !== store.bucket) {
      throw new DomainError('not_found', 'recording kept in another store', {
        reason: 'recording_missing',
      });
    }
    const get = await store.presignGet(stored.key, {
      filename: stored.name,
      disposition: 'inline',
    });
    return { url: get.url, expiresAt: get.expiresAt.toISOString() };
  });
}

/** The caller's own dial phone in a company, for their profile. */
export async function ownDialPhone(rawInput: unknown): Promise<ActionResult<string | null>> {
  return toResult('ownDialPhone', async () => {
    const principal = await signedIn();
    const input = parseInput(DialReadinessInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => ownDialPhoneQuery(context, input.entityId),
      { name: 'ownDialPhone' },
    );
  });
}

/** `crm.caller_profile.set_dial_phone`: the caller's own phone that a dial rings first. */
export async function saveDialPhone(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<DialPhoneDto>> {
  return toResult('saveDialPhone', async () => {
    const principal = await signedIn();
    // The phone as typed (ten digits, with or without +91 or a 0); empty clears it.
    const raw = rawInput as { entityId?: unknown; phone?: unknown } | null;
    const typed = typeof raw?.phone === 'string' ? raw.phone.trim() : raw?.phone;
    const phone = typeof typed === 'string' && typed !== '' ? normaliseIndianPhone(typed) : null;
    if (typeof typed === 'string' && typed !== '' && phone === null) {
      throw new DomainError('validation_failed', 'not an Indian phone number', {
        reason: 'phone_invalid',
        issues: [{ path: 'phone', message: 'phone_invalid' }],
      });
    }
    const input = parseInput(SetDialPhoneInput, { entityId: raw?.entityId, phone });
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      setDialPhone,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}
