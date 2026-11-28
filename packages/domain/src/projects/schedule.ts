import type { ScheduleConflictDto, UnavailabilityKind } from '@shakti/contracts';
import { WORKSHOP_DEFAULTS, type ScheduleDefaults } from '../workshop-defaults';

/**
 * The scheduling board's arithmetic (J5, docs/03-roadmap-appendix/phase4.md §7.2, question 6 (a)):
 * pure, so the commands, the board and the slot finder J9 and the Orchestrator call all reckon
 * alike. Travel is the straight-line distance between two sites × the road factor ÷ the average
 * speed (`WORKSHOP_DEFAULTS.projects.schedule`, PROJ-4); no routing service is ever called.
 */

/** A site's place on the map, in degrees. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/** A visit as the check reads it: who is on it (the engineer, or every member of the crew), when and where. */
export interface VisitFact {
  id: string;
  personIds: readonly string[];
  startsAt: Date;
  endsAt: Date;
  /** The site's point; null when it has no coordinates, or is another company's. */
  point: GeoPoint | null;
}

/** A person's time away. */
export interface AwayFact {
  id: string;
  personId: string;
  startsAt: Date;
  endsAt: Date;
  kind: UnavailabilityKind;
}

/** The travel rule: the road factor, the average speed and the buffer between visits. */
export type TravelRule = Pick<ScheduleDefaults, 'roadFactor' | 'averageSpeedKmh' | 'bufferMin'>;

export type ScheduleConflict = ScheduleConflictDto;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** India keeps one offset all year, with no summer time: UTC+05:30. */
const IST_OFFSET_MS = 330 * MINUTE_MS;
const EARTH_RADIUS_KM = 6371;

/** The straight-line (great-circle) distance between two points, in kilometres. */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Minutes on the road between two sites, rounded up to the whole minute; null when either place is unknown. */
export function travelMinutes(
  from: GeoPoint | null,
  to: GeoPoint | null,
  rule: TravelRule = WORKSHOP_DEFAULTS.projects.schedule,
): number | null {
  if (from === null || to === null) return null;
  const km = distanceKm(from, to) * rule.roadFactor;
  // A hair under the next minute stays in it: 0.1 + 0.2 must not become a minute more.
  return Math.ceil(Number(((km / rule.averageSpeedKmh) * 60).toFixed(6)));
}

/** The minutes a person needs between two visits: the buffer, and the trip when both places are known. */
function neededBetween(a: VisitFact, b: VisitFact, rule: TravelRule): number {
  return rule.bufferMin + (travelMinutes(a.point, b.point, rule) ?? 0);
}

const overlaps = (a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }) =>
  a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();

/** Whole minutes from one time to a later one. */
const minutesBetween = (from: Date, to: Date) =>
  Math.floor((to.getTime() - from.getTime()) / MINUTE_MS);

/** Ties broken by time, then id, so every caller gets the same order. */
const byTimeThenId = (a: VisitFact, b: VisitFact) =>
  a.startsAt.getTime() - b.startsAt.getTime() ||
  a.endsAt.getTime() - b.endsAt.getTime() ||
  a.id.localeCompare(b.id);

/** A person's other visits, in order. */
function visitsOf(personId: string, slot: VisitFact, existing: readonly VisitFact[]): VisitFact[] {
  return existing
    .filter((v) => v.id !== slot.id && v.personIds.includes(personId))
    .sort(byTimeThenId);
}

/** The person's visit just before the slot (ending at or before its start), if any. */
function previousOf(slot: VisitFact, visits: readonly VisitFact[]): VisitFact | undefined {
  let previous: VisitFact | undefined;
  for (const v of visits) {
    if (v.endsAt.getTime() > slot.startsAt.getTime()) continue;
    if (previous === undefined || v.endsAt.getTime() >= previous.endsAt.getTime()) previous = v;
  }
  return previous;
}

/** The person's visit just after the slot (starting at or after its end), if any. */
function nextOf(slot: VisitFact, visits: readonly VisitFact[]): VisitFact | undefined {
  return visits.find((v) => v.startsAt.getTime() >= slot.endsAt.getTime());
}

const KIND_ORDER = { double_booking: 0, unavailable: 1, travel_time: 2 } as const;

function conflict(
  kind: ScheduleConflict['kind'],
  personId: string,
  fields: Partial<Omit<ScheduleConflict, 'kind' | 'personId'>>,
): ScheduleConflict {
  return {
    kind,
    personId,
    slotId: null,
    unavailabilityId: null,
    unavailabilityKind: null,
    neededMin: null,
    gapMin: null,
    ...fields,
  };
}

/**
 * Every conflict of a visit (question 6 (a)), named, for each person on it:
 * - `double_booking`: another visit of theirs not cancelled overlaps it;
 * - `unavailable`: they are away for part of it;
 * - `travel_time`: the visit just before or just after leaves less than the trip between the two
 *   sites and the buffer (the buffer alone when either site has no coordinates).
 *
 * `existing` holds the people's other visits not cancelled (the slot itself is skipped by id), and
 * `unavailability` their time away. Visits that touch end to start do not overlap. Sorted by
 * person, kind and the other visit's or time away's id, so the same facts always give the same list.
 */
export function findScheduleConflicts(
  slot: VisitFact,
  existing: readonly VisitFact[],
  unavailability: readonly AwayFact[],
  travel: TravelRule = WORKSHOP_DEFAULTS.projects.schedule,
): ScheduleConflict[] {
  const found: ScheduleConflict[] = [];
  for (const personId of [...new Set(slot.personIds)].sort()) {
    const visits = visitsOf(personId, slot, existing);
    for (const v of visits) {
      if (overlaps(v, slot)) found.push(conflict('double_booking', personId, { slotId: v.id }));
    }
    for (const away of unavailability) {
      if (away.personId === personId && overlaps(away, slot)) {
        found.push(
          conflict('unavailable', personId, {
            unavailabilityId: away.id,
            unavailabilityKind: away.kind,
          }),
        );
      }
    }
    const apart = visits.filter((v) => !overlaps(v, slot));
    const previous = previousOf(slot, apart);
    if (previous !== undefined) {
      const neededMin = neededBetween(previous, slot, travel);
      const gapMin = minutesBetween(previous.endsAt, slot.startsAt);
      if (gapMin < neededMin) {
        found.push(conflict('travel_time', personId, { slotId: previous.id, neededMin, gapMin }));
      }
    }
    const next = nextOf(slot, apart);
    if (next !== undefined) {
      const neededMin = neededBetween(slot, next, travel);
      const gapMin = minutesBetween(slot.endsAt, next.startsAt);
      if (gapMin < neededMin) {
        found.push(conflict('travel_time', personId, { slotId: next.id, neededMin, gapMin }));
      }
    }
  }
  return found.sort(
    (a, b) =>
      a.personId.localeCompare(b.personId) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      (a.slotId ?? a.unavailabilityId ?? '').localeCompare(b.slotId ?? b.unavailabilityId ?? ''),
  );
}

/**
 * The minutes of travel a visit needs from the visit before it (`schedule_slots.travel_min`): the
 * longest trip any person on it makes from their own previous visit, or null when no such trip is
 * known (no previous visit, or a place without coordinates).
 */
export function travelFromPrevious(
  slot: VisitFact,
  existing: readonly VisitFact[],
  travel: TravelRule = WORKSHOP_DEFAULTS.projects.schedule,
): number | null {
  let longest: number | null = null;
  for (const personId of new Set(slot.personIds)) {
    const visits = visitsOf(personId, slot, existing).filter((v) => !overlaps(v, slot));
    const previous = previousOf(slot, visits);
    const minutes =
      previous === undefined ? null : travelMinutes(previous.point, slot.point, travel);
    if (minutes !== null && (longest === null || minutes > longest)) longest = minutes;
  }
  return longest;
}

/** Midnight IST at the start of a calendar day (`YYYY-MM-DD`), as an instant. */
export function istMidnight(day: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new RangeError(`not a day: ${day}`);
  const [, y, m, d] = match;
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)) - IST_OFFSET_MS);
}

/** The calendar day (`YYYY-MM-DD`) in IST of an instant. */
export function istDay(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The day `count` days after `day` (negative for before). */
export function addDays(day: string, count: number): string {
  return istDay(new Date(istMidnight(day).getTime() + count * DAY_MS));
}

/** What the slot finder places: the project's site and how long the visit lasts. */
export interface SlotRequest {
  point: GeoPoint | null;
  durationMin: number;
}

/** The days the finder looks in: `days` calendar days in IST from `firstDay`. */
export interface SlotWindow {
  firstDay: string;
  days: number;
}

/** The people's other visits and time away the finder works around. */
export interface ScheduleFacts {
  visits: readonly VisitFact[];
  away: readonly AwayFact[];
}

export interface SuggestOptions {
  /** The travel rule and the working day; the workshop's by default. */
  rules?: ScheduleDefaults;
  /** No time before this one is offered (now, for a booking). */
  notBefore?: Date;
  /** The most suggestions answered. */
  limit?: number;
}

/** A free time for one engineer, and the trip to it from their visit before on the same day. */
export interface SlotSuggestion {
  engineerId: string;
  startsAt: Date;
  endsAt: Date;
  /** Minutes from the visit before; null with no visit before that day, or a place unknown. */
  travelMin: number | null;
}

/**
 * Free times for a visit (docs/03-roadmap-appendix/phase4.md §7.2, PRJ-04): for each engineer and
 * each day of the window, the earliest start in each gap of their working day (09:30 to 18:00
 * IST by default) at which the visit fits with no conflict at all (`findScheduleConflicts()`
 * finds none). After a visit, a gap opens once the buffer and the trip to this site have passed.
 *
 * Ranked by the travel from the engineer's visit before on the same day, shortest first; a time
 * with no known trip (the engineer's first visit of the day, or a site without coordinates) comes
 * after every known one, since where they start from is not known. Equal scores go by the earlier
 * start, then by the engineer's id, so the order is the same every time. Nothing is saved: J9's
 * booking and the Orchestrator offer these, and a person confirms (PRJ-04).
 */
export function suggestSlots(
  project: SlotRequest,
  window: SlotWindow,
  engineers: readonly string[],
  existing: ScheduleFacts,
  options: SuggestOptions = {},
): SlotSuggestion[] {
  const rules = options.rules ?? WORKSHOP_DEFAULTS.projects.schedule;
  const limit = options.limit ?? 10;
  const durationMs = project.durationMin * MINUTE_MS;
  const found: SlotSuggestion[] = [];
  for (const engineerId of [...new Set(engineers)].sort()) {
    const visits = existing.visits.filter((v) => v.personIds.includes(engineerId));
    const away = existing.away.filter((a) => a.personId === engineerId);
    for (let i = 0; i < window.days; i += 1) {
      const midnight = istMidnight(addDays(window.firstDay, i)).getTime();
      const dayStart = midnight + rules.workingDay.startMin * MINUTE_MS;
      const dayEnd = midnight + rules.workingDay.endMin * MINUTE_MS;
      // The earliest start of each gap: the day's start, the end of each time away, and the end
      // of each visit (the buffer and the trip are added below).
      const starts = new Set<number>([dayStart]);
      for (const b of [...visits, ...away]) {
        const end = b.endsAt.getTime();
        if (end > dayStart && end < dayEnd) starts.add(end);
      }
      for (const raw of [...starts].sort((a, b) => a - b)) {
        let start = Math.max(raw, options.notBefore?.getTime() ?? raw);
        const probe: VisitFact = {
          id: '',
          personIds: [engineerId],
          startsAt: new Date(start),
          endsAt: new Date(start + durationMs),
          point: project.point,
        };
        // The visit before on the same day, if any, sets the earliest start and the score.
        const previous = previousOf(
          probe,
          visits.filter((v) => !overlaps(v, probe) && v.endsAt.getTime() > midnight),
        );
        let travelMin: number | null = null;
        if (previous !== undefined) {
          travelMin = travelMinutes(previous.point, project.point, rules);
          const ready =
            previous.endsAt.getTime() + (rules.bufferMin + (travelMin ?? 0)) * MINUTE_MS;
          start = Math.max(start, ready);
        }
        const slot: VisitFact = {
          ...probe,
          startsAt: new Date(start),
          endsAt: new Date(start + durationMs),
        };
        if (start + durationMs > dayEnd) continue;
        if (findScheduleConflicts(slot, visits, away, rules).length > 0) continue;
        if (found.some((f) => f.engineerId === engineerId && f.startsAt.getTime() === start))
          continue;
        found.push({ engineerId, startsAt: slot.startsAt, endsAt: slot.endsAt, travelMin });
      }
    }
  }
  const score = (s: SlotSuggestion) => s.travelMin ?? Number.POSITIVE_INFINITY;
  return found
    .sort(
      (a, b) =>
        score(a) - score(b) ||
        a.startsAt.getTime() - b.startsAt.getTime() ||
        a.engineerId.localeCompare(b.engineerId),
    )
    .slice(0, limit);
}
