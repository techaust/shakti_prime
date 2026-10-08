import type { NoticeType, PushPlan } from '@shakti/contracts';

/*
 * Who sees a notice and whether it is pushed (docs/03-roadmap-appendix/phase1.md §8.1): pure, so the notify
 * worker and its tests agree. A person who has set nothing sees and receives every kind of notice
 * at any hour (the lead's default of 06-10-2026; nothing is assumed about the client's hours).
 */

/** How far back the scan looks for a call falling due or a first call running late. */
export const NOTICE_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** How long before a quote lapses its lead's owner is told (one day, the lead's decision). */
export const QUOTE_EXPIRY_NOTICE_MS = 24 * 60 * 60 * 1000;

/** How many finds of each kind one scan batch of a company takes. */
export const NOTICE_SCAN_LIMIT = 200;

/**
 * How long a push may stay pending before the scan sends it again: longer than a run, so a push
 * the running scan is still sending is left alone.
 */
export const NOTICE_PUSH_RETRY_AFTER_SECONDS = 120;

const IST_OFFSET_MINUTES = 330;

/** Minutes since midnight of an `HH:MM` time. */
export function minuteOf(time: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (match === null) throw new RangeError(`not a time of day: ${time}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Minutes since midnight in IST at `at`. */
export function istMinute(at: Date): number {
  const minutes = Math.floor(at.getTime() / 60_000) + IST_OFFSET_MINUTES;
  return ((minutes % 1440) + 1440) % 1440;
}

/**
 * True when `at` falls in the quiet hours from `from` up to, not including, `to` (IST); hours that
 * end earlier than they start run across midnight (22:00 to 07:00). No quiet hours, none.
 */
export function inQuietHours(at: Date, from: string | null, to: string | null): boolean {
  if (from === null || to === null) return false;
  const start = minuteOf(from);
  const end = minuteOf(to);
  if (start === end) return false;
  const now = istMinute(at);
  return start < end ? now >= start && now < end : now >= start || now < end;
}

/** One row of a person's settings: a kind with its switches, or no kind with the quiet hours. */
export interface NoticeSettingRow {
  userId: string;
  type: string | null;
  inApp: boolean;
  push: boolean;
  quietFrom: string | null;
  quietTo: string | null;
}

/** What a person chose for one kind of notice. */
export interface NoticeChoice {
  inApp: boolean;
  push: boolean;
  quietFrom: string | null;
  quietTo: string | null;
}

/** A person's choice for a kind: their row for it and their quiet hours, else every switch on. */
export function choiceFor(
  rows: readonly NoticeSettingRow[],
  userId: string,
  type: NoticeType,
): NoticeChoice {
  const own = rows.filter((r) => r.userId === userId);
  const kind = own.find((r) => r.type === type);
  const quiet = own.find((r) => r.type === null);
  return {
    inApp: kind?.inApp ?? true,
    push: kind?.push ?? true,
    quietFrom: quiet?.quietFrom ?? null,
    quietTo: quiet?.quietTo ?? null,
  };
}

/**
 * Whether a new notice is pushed now: `off` when the person turned pushes off for its kind,
 * `none` without a browser to send to, `held` in their quiet hours (never sent later: the notice
 * waits in the centre), `send` otherwise.
 */
export function pushPlan(choice: NoticeChoice, browsers: number, at: Date): PushPlan {
  if (!choice.push) return 'off';
  if (browsers === 0) return 'none';
  if (inQuietHours(at, choice.quietFrom, choice.quietTo)) return 'held';
  return 'send';
}
