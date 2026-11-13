import type { LeadChannel } from '@shakti/contracts';
import { DndRegistryUnavailable, type DndAnswer, type DndRegistry } from '../ports/dnd';
import { WORKSHOP_DEFAULTS } from '../workshop-defaults';
import { callPurpose, type PurposeReason } from './call-purpose';
import {
  checkDial,
  numberSeries,
  type CallPurpose,
  type DialDecision,
  type NumberSeries,
} from './dial-policy';

/**
 * A dial planned from its facts (docs/03-roadmap-appendix/phase2.md §5.2): the purpose by consent
 * (`callPurpose`), the company's number for that purpose, the DND state, fresh or looked up again,
 * and `checkDial` over all of it. The Cold Caller and Converting workspaces show the plan before
 * the Dial key exists; the dial command (T3) runs the same plan before it reaches the provider.
 */

/** What `app.dial_facts()` answers for a lead and one phone of its customer. */
export interface DialFacts {
  entityId: number;
  sourceChannel: LeadChannel | null;
  hasOpenCallback: boolean;
  hasOrder: boolean;
  phoneE164: string;
  phoneIsDnd: boolean;
  phoneDndCheckedAt: Date | null;
  hasServiceConsent: boolean;
  callConsentWithdrawn: boolean;
  /** The company's 140-series number in use, if it has one. */
  promoNumber: string | null;
  /** The company's 160-series number in use, if it has one. */
  serviceNumber: string | null;
}

/** The DND state a plan used: as recorded, looked up just now, or not to be had. */
export type DndState =
  | { kind: 'recorded'; onDnd: boolean; checkedAt: Date }
  | { kind: 'refreshed'; onDnd: boolean; checkedAt: Date }
  | { kind: 'unknown'; checkedAt: Date | null };

export interface DialPlan {
  purpose: CallPurpose;
  purposeReason: PurposeReason;
  /** The company's number the call would go out on, or null when it has none for the purpose. */
  callerId: string | null;
  series: NumberSeries | null;
  dnd: DndState;
  decision: DialDecision;
}

const DAY_MS = 86_400_000;

/** A DND answer is fresh for `freshDays` days (`WORKSHOP_DEFAULTS.calling.dndFreshDays`). */
export function dndIsFresh(
  checkedAt: Date | null,
  now: Date,
  freshDays: number = WORKSHOP_DEFAULTS.calling.dndFreshDays,
): boolean {
  return checkedAt !== null && now.getTime() - checkedAt.getTime() < freshDays * DAY_MS;
}

/** The plan for a known DND state. */
export function planDial(facts: DialFacts, at: Date, dnd: DndState): DialPlan {
  const { purpose, why } = callPurpose(facts);
  const callerId = purpose === 'service' ? facts.serviceNumber : facts.promoNumber;
  const decision = checkDial({
    at,
    purpose,
    callerId,
    to: facts.phoneE164,
    hasRecordedConsent: facts.hasServiceConsent,
    onDnd: dnd.kind === 'unknown' ? 'unknown' : dnd.onDnd,
    callConsentWithdrawn: facts.callConsentWithdrawn,
  });
  return {
    purpose,
    purposeReason: why,
    callerId,
    series: callerId === null ? null : numberSeries(callerId),
    dnd,
    decision,
  };
}

/** How long the register may take before the dial treats it as not answering. */
export const DND_LOOKUP_TIMEOUT_MS = 3_000;

export interface PrepareDialDeps {
  registry: DndRegistry;
  /**
   * Records the register's answer as the platform (`crm.phone.dnd_record`), before the plan uses
   * it. A failure to record is the platform's, not the dial's: the answer still holds for this
   * plan, and the next dial asks again.
   */
  record: (answer: DndAnswer) => Promise<void>;
  freshDays?: number;
  timeoutMs?: number;
}

/**
 * The plan for a dial now. Only a promotional call needs the DND state: one whose recorded check
 * is older than `freshDays` (or that was never checked) is looked up again and the answer
 * recorded; a register that does not answer in time leaves it `unknown`, which refuses the
 * promotional dial (`dnd_unknown`) and never a service call, which asks the register nothing.
 */
export async function prepareDial(
  facts: DialFacts,
  now: Date,
  deps: PrepareDialDeps,
): Promise<DialPlan> {
  const recorded: DndState =
    facts.phoneDndCheckedAt === null
      ? { kind: 'unknown', checkedAt: null }
      : { kind: 'recorded', onDnd: facts.phoneIsDnd, checkedAt: facts.phoneDndCheckedAt };
  const { purpose } = callPurpose(facts);
  if (purpose === 'service' || dndIsFresh(facts.phoneDndCheckedAt, now, deps.freshDays)) {
    return planDial(facts, now, recorded);
  }
  const answer = await lookUp(deps.registry, facts.phoneE164, deps.timeoutMs);
  if (answer === undefined) {
    return planDial(facts, now, { kind: 'unknown', checkedAt: facts.phoneDndCheckedAt });
  }
  await deps.record(answer).catch(() => undefined);
  return planDial(facts, now, { kind: 'refreshed', ...answer });
}

/** The register's answer, or undefined when it did not answer in time or failed. */
async function lookUp(
  registry: DndRegistry,
  e164: string,
  timeoutMs: number = DND_LOOKUP_TIMEOUT_MS,
): Promise<DndAnswer | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new DndRegistryUnavailable('the DND register took too long'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([registry.check(e164), timeout]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
