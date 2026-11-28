import { describe, expect, it } from 'vitest';
import { WORKSHOP_DEFAULTS } from '../workshop-defaults';
import {
  addDays,
  distanceKm,
  findScheduleConflicts,
  istDay,
  istMidnight,
  suggestSlots,
  travelFromPrevious,
  travelMinutes,
  type AwayFact,
  type GeoPoint,
  type VisitFact,
} from './schedule';

// J5 (docs/03-roadmap-appendix/phase4.md §7.2, §13): the conflict check and the slot finder at
// their edges. Times are written in IST (+05:30), as the board shows them.
const RULE = WORKSHOP_DEFAULTS.projects.schedule;
const at = (ist: string) => new Date(`${ist}:00+05:30`);
const ENG = 'e1';
const OTHER = 'e2';

// Two sites 0.1° of latitude apart: 11.12 km in a straight line, 15.57 km by road, 31.1 minutes
// at 30 km/h, so 32 minutes of travel; with the 15-minute buffer a person needs 47 minutes.
const HERE: GeoPoint = { lat: 26.9, lng: 75.8 };
const THERE: GeoPoint = { lat: 27.0, lng: 75.8 };
const NEEDED = 47;

let ids = 0;
function visit(
  from: string,
  to: string,
  options: { people?: string[]; point?: GeoPoint | null; id?: string } = {},
): VisitFact {
  ids += 1;
  return {
    id: options.id ?? `v${ids.toString().padStart(3, '0')}`,
    personIds: options.people ?? [ENG],
    startsAt: at(from),
    endsAt: at(to),
    point: options.point === undefined ? HERE : options.point,
  };
}

function away(from: string, to: string, personId = ENG): AwayFact {
  return {
    id: 'u1',
    personId,
    startsAt: at(from),
    endsAt: at(to),
    kind: 'leave',
  };
}

describe('travel', () => {
  it('is the straight-line distance × the road factor ÷ the speed, rounded up to the minute', () => {
    expect(distanceKm(HERE, THERE)).toBeCloseTo(11.12, 2);
    expect(travelMinutes(HERE, THERE)).toBe(32);
    expect(travelMinutes(HERE, HERE)).toBe(0);
    expect(travelMinutes({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBe(312);
    expect(travelMinutes(HERE, THERE, { ...RULE, averageSpeedKmh: 60 })).toBe(16);
  });

  it('is unknown when either site has no coordinates', () => {
    expect(travelMinutes(null, THERE)).toBeNull();
    expect(travelMinutes(HERE, null)).toBeNull();
  });
});

describe('findScheduleConflicts', () => {
  it('finds none for a free person', () => {
    const slot = visit('2026-12-01T10:00', '2026-12-01T11:00');
    expect(findScheduleConflicts(slot, [], [])).toEqual([]);
  });

  it('names a double booking with the other visit, and skips the visit itself', () => {
    const slot = visit('2026-12-01T10:00', '2026-12-01T12:00', { id: 'slot' });
    const other = visit('2026-12-01T11:00', '2026-12-01T13:00', { id: 'other' });
    expect(findScheduleConflicts(slot, [slot, other], [])).toEqual([
      {
        kind: 'double_booking',
        personId: ENG,
        slotId: 'other',
        unavailabilityId: null,
        unavailabilityKind: null,
        neededMin: null,
        gapMin: null,
      },
    ]);
  });

  it('treats back-to-back visits as apart, and names too little time between them', () => {
    const slot = visit('2026-12-01T11:00', '2026-12-01T12:00', { id: 'slot', point: THERE });
    const before = visit('2026-12-01T10:00', '2026-12-01T11:00', { id: 'before' });
    const after = visit('2026-12-01T12:00', '2026-12-01T13:00', { id: 'after' });
    expect(findScheduleConflicts(slot, [before, after], [])).toEqual([
      expect.objectContaining({
        kind: 'travel_time',
        slotId: 'after',
        neededMin: NEEDED,
        gapMin: 0,
      }),
      expect.objectContaining({
        kind: 'travel_time',
        slotId: 'before',
        neededMin: NEEDED,
        gapMin: 0,
      }),
    ]);
  });

  it('accepts a gap of exactly the trip and the buffer, and refuses a minute less', () => {
    const before = visit('2026-12-01T09:30', '2026-12-01T10:00', { id: 'before' });
    const enough = visit('2026-12-01T10:47', '2026-12-01T11:30', { point: THERE });
    const short = visit('2026-12-01T10:46', '2026-12-01T11:30', { point: THERE });
    expect(findScheduleConflicts(enough, [before], [])).toEqual([]);
    expect(findScheduleConflicts(short, [before], [])).toEqual([
      expect.objectContaining({
        kind: 'travel_time',
        slotId: 'before',
        neededMin: NEEDED,
        gapMin: 46,
      }),
    ]);
  });

  it('asks only the buffer when a site has no coordinates', () => {
    const before = visit('2026-12-01T09:30', '2026-12-01T10:00', { point: null });
    expect(
      findScheduleConflicts(visit('2026-12-01T10:15', '2026-12-01T11:00'), [before], []),
    ).toEqual([]);
    expect(
      findScheduleConflicts(visit('2026-12-01T10:14', '2026-12-01T11:00'), [before], []),
    ).toEqual([
      expect.objectContaining({ kind: 'travel_time', neededMin: RULE.bufferMin, gapMin: 14 }),
    ]);
  });

  it('checks only the visits just before and just after', () => {
    const early = visit('2026-12-01T06:00', '2026-12-01T06:30', { id: 'early', point: THERE });
    const before = visit('2026-12-01T09:00', '2026-12-01T09:30', { id: 'before' });
    const slot = visit('2026-12-01T09:45', '2026-12-01T10:30');
    expect(findScheduleConflicts(slot, [early, before], [])).toEqual([]);
  });

  it('names time away that overlaps, with its kind', () => {
    const slot = visit('2026-12-01T10:00', '2026-12-01T11:00');
    expect(findScheduleConflicts(slot, [], [away('2026-12-01T10:30', '2026-12-02T00:00')])).toEqual(
      [
        expect.objectContaining({
          kind: 'unavailable',
          unavailabilityId: 'u1',
          unavailabilityKind: 'leave',
        }),
      ],
    );
    expect(findScheduleConflicts(slot, [], [away('2026-12-01T11:00', '2026-12-01T12:00')])).toEqual(
      [],
    );
    expect(
      findScheduleConflicts(slot, [], [away('2026-12-01T10:00', '2026-12-01T11:00', OTHER)]),
    ).toEqual([]);
  });

  it('checks a visit crossing midnight IST against both days', () => {
    const night = visit('2026-12-01T22:00', '2026-12-02T02:00', { id: 'night' });
    const morning = visit('2026-12-02T01:00', '2026-12-02T03:00');
    const late = visit('2026-12-02T02:05', '2026-12-02T03:00');
    expect(findScheduleConflicts(morning, [night], [])).toEqual([
      expect.objectContaining({ kind: 'double_booking', slotId: 'night' }),
    ]);
    expect(findScheduleConflicts(late, [night], [])).toEqual([
      expect.objectContaining({ kind: 'travel_time', slotId: 'night', neededMin: 15, gapMin: 5 }),
    ]);
  });

  it('checks every member of a crew, ordered by person, kind and id', () => {
    const crew = visit('2026-12-01T10:00', '2026-12-01T12:00', { people: [OTHER, ENG] });
    const a = visit('2026-12-01T11:00', '2026-12-01T13:00', { id: 'b-visit', people: [OTHER] });
    const b = visit('2026-12-01T09:00', '2026-12-01T10:30', { id: 'a-visit', people: [ENG] });
    const result = findScheduleConflicts(
      crew,
      [a, b],
      [away('2026-12-01T09:00', '2026-12-01T18:00')],
    );
    expect(result.map((c) => [c.personId, c.kind, c.slotId ?? c.unavailabilityId])).toEqual([
      [ENG, 'double_booking', 'a-visit'],
      [ENG, 'unavailable', 'u1'],
      [OTHER, 'double_booking', 'b-visit'],
    ]);
  });
});

describe('travelFromPrevious', () => {
  it('is the trip from the visit before, null with none or an unknown place', () => {
    const slot = visit('2026-12-01T12:00', '2026-12-01T13:00', { point: THERE });
    expect(travelFromPrevious(slot, [visit('2026-12-01T09:30', '2026-12-01T10:30')])).toBe(32);
    expect(travelFromPrevious(slot, [])).toBeNull();
    expect(
      travelFromPrevious(slot, [visit('2026-12-01T09:30', '2026-12-01T10:30', { point: null })]),
    ).toBeNull();
  });
});

describe('IST days', () => {
  it('starts a day at midnight IST, 18:30 UTC the evening before', () => {
    expect(istMidnight('2026-12-01').toISOString()).toBe('2026-11-30T18:30:00.000Z');
    expect(istDay(new Date('2026-11-30T18:29:59Z'))).toBe('2026-11-30');
    expect(istDay(new Date('2026-11-30T18:30:00Z'))).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('suggestSlots', () => {
  const DAY = '2026-12-01';
  const hour = { point: THERE, durationMin: 60 };

  it('offers an engineer with no previous visit the start of the working day, with no trip known', () => {
    expect(suggestSlots(hour, { firstDay: DAY, days: 1 }, [ENG], { visits: [], away: [] })).toEqual(
      [
        {
          engineerId: ENG,
          startsAt: at(`${DAY}T09:30`),
          endsAt: at(`${DAY}T10:30`),
          travelMin: null,
        },
      ],
    );
  });

  it('ranks by the trip from the visit before, nearest first, then the rest by time', () => {
    const near = visit(`${DAY}T09:30`, `${DAY}T10:30`, { people: [OTHER], point: THERE });
    const far = visit(`${DAY}T09:30`, `${DAY}T10:30`, { people: [ENG], point: HERE });
    const result = suggestSlots(hour, { firstDay: DAY, days: 1 }, [ENG, OTHER], {
      visits: [near, far],
      away: [],
    });
    expect(result.map((s) => [s.engineerId, s.startsAt.toISOString(), s.travelMin])).toEqual([
      [OTHER, at(`${DAY}T10:45`).toISOString(), 0],
      [ENG, at(`${DAY}T11:17`).toISOString(), 32],
    ]);
  });

  it('breaks equal scores by start and then by engineer, the same every time', () => {
    const facts = { visits: [], away: [] };
    const one = suggestSlots(hour, { firstDay: DAY, days: 2 }, [OTHER, ENG], facts);
    const two = suggestSlots(hour, { firstDay: DAY, days: 2 }, [ENG, OTHER], facts);
    expect(one).toEqual(two);
    expect(one.map((s) => [s.engineerId, istDay(s.startsAt)])).toEqual([
      [ENG, DAY],
      [OTHER, DAY],
      [ENG, '2026-12-02'],
      [OTHER, '2026-12-02'],
    ]);
  });

  it('skips time away and the gaps too short for the visit, and keeps within the working day', () => {
    const busy = visit(`${DAY}T10:00`, `${DAY}T17:00`, { point: THERE });
    const result = suggestSlots(hour, { firstDay: DAY, days: 1 }, [ENG], {
      visits: [busy],
      away: [],
    });
    // 09:30 leaves 30 minutes before the 10:00 visit, and after it only 45 of the 60 minutes fit.
    expect(result).toEqual([]);
    const onLeave = suggestSlots(hour, { firstDay: DAY, days: 1 }, [OTHER], {
      visits: [],
      away: [away(`${DAY}T00:00`, `${DAY}T13:00`, OTHER)],
    });
    expect(onLeave.map((s) => s.startsAt)).toEqual([at(`${DAY}T13:00`)]);
  });

  it('counts a visit crossing midnight IST as the previous visit of the next morning', () => {
    const night = visit('2026-11-30T23:00', `${DAY}T09:00`, { point: HERE });
    const result = suggestSlots(hour, { firstDay: DAY, days: 1 }, [ENG], {
      visits: [night],
      away: [],
    });
    expect(result).toEqual([
      { engineerId: ENG, startsAt: at(`${DAY}T09:47`), endsAt: at(`${DAY}T10:47`), travelMin: 32 },
    ]);
  });

  it('offers nothing before the time given, and at most the limit', () => {
    const facts = { visits: [], away: [] };
    const later = suggestSlots(hour, { firstDay: DAY, days: 1 }, [ENG], facts, {
      notBefore: at(`${DAY}T15:00`),
    });
    expect(later.map((s) => s.startsAt)).toEqual([at(`${DAY}T15:00`)]);
    expect(
      suggestSlots(hour, { firstDay: DAY, days: 7 }, [ENG, OTHER], facts, { limit: 3 }),
    ).toHaveLength(3);
  });

  it('never offers a time that conflicts', () => {
    const visits = [
      visit(`${DAY}T09:30`, `${DAY}T10:15`, { point: HERE }),
      visit(`${DAY}T12:00`, `${DAY}T13:00`, { point: HERE }),
      visit(`${DAY}T13:30`, `${DAY}T14:00`, { point: null, people: [OTHER] }),
    ];
    const result = suggestSlots(hour, { firstDay: DAY, days: 1 }, [ENG, OTHER], {
      visits,
      away: [],
    });
    expect(result.length).toBeGreaterThan(0);
    for (const s of result) {
      const slot = {
        id: 'x',
        personIds: [s.engineerId],
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        point: THERE,
      };
      expect(findScheduleConflicts(slot, visits, [])).toEqual([]);
    }
  });
});
