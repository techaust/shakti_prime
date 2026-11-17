/**
 * The caller's number from the screen-pop to the New lead form (PRD TEL-05: an unknown number
 * opens the form with the number filled in). It goes through this tab's session storage, never the
 * address, so a customer's number reaches no address bar, history or log. It is taken once, and
 * only within two minutes of the call. An event tells a form that is already open.
 */

const KEY = 'bos.screen-pop.new-lead-phone';
export const NEW_LEAD_PHONE_EVENT = 'bos:new-lead-phone';
const KEPT_MS = 120_000;
const E164 = /^\+[1-9]\d{6,14}$/;

/** Leaves the number for the form, and tells a form already open. */
export function handOverPhone(phone: string, now: number = Date.now()): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ phone, at: now }));
  } catch {
    // A browser that keeps nothing in session storage opens the form empty.
  }
  window.dispatchEvent(new Event(NEW_LEAD_PHONE_EVENT));
}

/** The number left for the form, taken once; undefined when none is waiting or it is stale. */
export function takeHandedPhone(now: number = Date.now()): string | undefined {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;
  try {
    const kept = JSON.parse(raw) as { phone?: unknown; at?: unknown };
    if (typeof kept.phone !== 'string' || typeof kept.at !== 'number') return undefined;
    if (!E164.test(kept.phone) || now - kept.at > KEPT_MS || kept.at > now) return undefined;
    return kept.phone;
  } catch {
    return undefined;
  }
}

/** The number as a caller types it: an Indian mobile as "98765 43210", any other as given. */
export function typedPhone(e164: string): string {
  const indian = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return indian === null ? e164 : `${indian[1] ?? ''} ${indian[2] ?? ''}`;
}
