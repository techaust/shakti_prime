/**
 * Outbound calling rules (docs/SECURITY.md §7, BLUEPRINT §9.3 hard guardrails): TRAI calling hours,
 * the DLT number series and recorded consent. Pure functions: the dial command calls them with the
 * clock, the caller id it is about to use, the call's purpose and the lead's consent and DND state.
 */

/** India has one time zone and no daylight saving: a fixed offset is exact. */
const IST_OFFSET_MINUTES = 330;

/** Calls may start from 09:00 IST and must start before 21:00 IST (TRAI, TCCCPR 2018). */
export const CALLING_WINDOW_IST = { startMinute: 9 * 60, endMinute: 21 * 60 } as const;

/** Why a call is made: promotional (selling) or service (about something the person asked for). */
export type CallPurpose = 'promotional' | 'service';

/** The DLT series of a caller id: 140 for promotional, 160 for service and transactional calls. */
export type NumberSeries = '140' | '160' | 'other';

/** Why the policy refuses a call. Internal codes; a screen maps each to a sentence. */
export type DialRefusal =
  | 'outside_calling_hours'
  | 'caller_id_not_promotional'
  | 'caller_id_not_service'
  | 'service_call_without_consent'
  | 'recipient_on_dnd'
  | 'recipient_not_a_mobile_number';

export type DialDecision = { allowed: true } | { allowed: false; refusals: DialRefusal[] };

export interface DialRequest {
  at: Date;
  purpose: CallPurpose;
  /** The number the customer sees, as registered on DLT for the entity. */
  callerId: string;
  /** The person being called. */
  to: string;
  /** A consent for calls from this entity is recorded and not withdrawn. */
  hasRecordedConsent: boolean;
  /** The last DND scrub found the number on the NCPR preference register. */
  onDnd: boolean;
}

/** Minutes since midnight in IST. */
export function istMinuteOfDay(at: Date): number {
  const minutes = Math.floor(at.getTime() / 60_000) + IST_OFFSET_MINUTES;
  return ((minutes % 1440) + 1440) % 1440;
}

/** True from 09:00 up to, not including, 21:00 IST. */
export function withinCallingHours(at: Date): boolean {
  const minute = istMinuteOfDay(at);
  return minute >= CALLING_WINDOW_IST.startMinute && minute < CALLING_WINDOW_IST.endMinute;
}

/** The digits of an Indian number without the country code or trunk prefix. */
export function nationalNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

/**
 * The DLT series of a caller id. 140-series numbers are ten digits starting 140 (promotional);
 * 160-series numbers are ten digits starting 160 (service and transactional, allotted from 2025).
 */
export function numberSeries(callerId: string): NumberSeries {
  const national = nationalNumber(callerId);
  if (national.length !== 10) return 'other';
  if (national.startsWith('140')) return '140';
  if (national.startsWith('160')) return '160';
  return 'other';
}

/** An Indian mobile number: ten digits starting 6 to 9. */
export function isIndianMobile(raw: string): boolean {
  return /^[6-9]\d{9}$/.test(nationalNumber(raw));
}

/**
 * Whether a call may be placed now, and every rule it breaks when it may not.
 * - Every call: only within TRAI hours, and only to an Indian mobile number.
 * - Promotional: a 140-series caller id, and never to a number on DND.
 * - Service: a 160-series caller id and a recorded consent; consent is what makes a service call
 *   to a number on DND lawful, so DND does not refuse a service call that has it.
 */
export function checkDial(request: DialRequest): DialDecision {
  const refusals: DialRefusal[] = [];
  if (!withinCallingHours(request.at)) refusals.push('outside_calling_hours');
  if (!isIndianMobile(request.to)) refusals.push('recipient_not_a_mobile_number');
  const series = numberSeries(request.callerId);
  if (request.purpose === 'promotional') {
    if (series !== '140') refusals.push('caller_id_not_promotional');
    if (request.onDnd) refusals.push('recipient_on_dnd');
  } else {
    if (series !== '160') refusals.push('caller_id_not_service');
    if (!request.hasRecordedConsent) refusals.push('service_call_without_consent');
  }
  return refusals.length === 0 ? { allowed: true } : { allowed: false, refusals };
}

/** The next instant calls may start, for a call refused only by the hour. */
export function nextCallingWindowStart(at: Date): Date {
  const minute = istMinuteOfDay(at);
  if (minute < CALLING_WINDOW_IST.startMinute) {
    return new Date(
      at.getTime() + (CALLING_WINDOW_IST.startMinute - minute) * 60_000 - (at.getTime() % 60_000),
    );
  }
  if (minute >= CALLING_WINDOW_IST.endMinute) {
    return new Date(
      at.getTime() +
        (1440 - minute + CALLING_WINDOW_IST.startMinute) * 60_000 -
        (at.getTime() % 60_000),
    );
  }
  return at;
}
