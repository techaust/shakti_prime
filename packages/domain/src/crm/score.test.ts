import { SegmentSchema } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { WORKSHOP_DEFAULTS } from '../workshop-defaults';
import { scoreLead, scoreReasonKey, type ScoreFacts, type ScoreRule } from './score';

/** A small deterministic generator, so a failing case reproduces (the Verhoeff tests' pattern). */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const NOW = new Date('2026-09-30T06:30:00Z');
const DAY = 24 * 60 * 60 * 1000;

function lead(overrides: Partial<ScoreFacts> = {}): ScoreFacts {
  return {
    entityId: 1,
    segment: 'farmer_pumps',
    sourceCode: 'walk_in',
    district: 'Nashik',
    systemSize: { kw: null, hp: 5 },
    createdAt: new Date(NOW.getTime() - 3 * DAY),
    ...overrides,
  };
}

function rule(overrides: Partial<ScoreRule> & Pick<ScoreRule, 'factor' | 'match'>): ScoreRule {
  return { entityId: null, segment: null, points: 10, ...overrides };
}

describe('scoreLead', () => {
  it('starts every lead at the workshop base of 50 with no reasons when there are no rules', () => {
    expect(WORKSHOP_DEFAULTS.crm.scoreBase).toBe(50);
    expect(scoreLead(lead(), [], NOW)).toEqual({ score: 50, reasons: [] });
  });

  it('adds the points of each matching rule, in rule order, with its reason', () => {
    const rules = [
      rule({ factor: 'source', match: { sourceCodes: ['walk_in', 'missed_call'] }, points: 20 }),
      rule({ factor: 'district', match: { districts: ['nashik'] }, points: -5 }),
      rule({ factor: 'segment', match: { segments: ['residential_rooftop'] }, points: 30 }),
    ];
    expect(scoreLead(lead(), rules, NOW)).toEqual({
      score: 65,
      reasons: [
        { factor: 'source', points: 20, labelKey: scoreReasonKey('source') },
        { factor: 'district', points: -5, labelKey: scoreReasonKey('district') },
      ],
    });
  });

  it('matches source codes and districts whatever their case and spacing', () => {
    const rules = [
      rule({ factor: 'source', match: { sourceCodes: [' WALK_IN '] } }),
      rule({ factor: 'district', match: { districts: ['  NASHIK'] } }),
    ];
    expect(scoreLead(lead(), rules, NOW).score).toBe(70);
  });

  it('never matches a source or district the lead does not have', () => {
    const rules = [
      rule({ factor: 'source', match: { sourceCodes: ['walk_in'] } }),
      rule({ factor: 'district', match: { districts: ['Nashik'] } }),
    ];
    expect(scoreLead(lead({ sourceCode: null, district: null }), rules, NOW).score).toBe(50);
    expect(scoreLead(lead({ district: '   ' }), rules.slice(1), NOW).score).toBe(50);
  });

  it('applies a rule only in its own company and segment, or everywhere when it names none', () => {
    const match = { sourceCodes: ['walk_in'] };
    const rules = [
      rule({ factor: 'source', match, entityId: 2, points: 40 }),
      rule({ factor: 'source', match, segment: 'commercial_epc', points: 30 }),
      rule({ factor: 'source', match, entityId: 1, segment: 'farmer_pumps', points: 7 }),
    ];
    expect(scoreLead(lead(), rules, NOW).score).toBe(57);
    expect(scoreLead(lead({ entityId: 2 }), rules, NOW).score).toBe(90);
  });

  it('reads the age in whole days, with both bounds included', () => {
    const r = rule({ factor: 'age_days', match: { minDays: 3, maxDays: 7 }, points: -10 });
    const aged = (ms: number) => lead({ createdAt: new Date(NOW.getTime() - ms) });
    expect(scoreLead(aged(3 * DAY), [r], NOW).score).toBe(40);
    expect(scoreLead(aged(3 * DAY - 1), [r], NOW).score).toBe(50);
    expect(scoreLead(aged(7 * DAY + DAY - 1), [r], NOW).score).toBe(40);
    expect(scoreLead(aged(8 * DAY), [r], NOW).score).toBe(50);
    // A lead dated after now counts as new, never as a negative age.
    const fresh = rule({ factor: 'age_days', match: { maxDays: 0 }, points: 5 });
    expect(scoreLead(lead({ createdAt: new Date(NOW.getTime() + DAY) }), [fresh], NOW).score).toBe(
      55,
    );
  });

  it('reads the system size in the unit the rule names, and not at all when unrecorded', () => {
    const hp = rule({ factor: 'system_size', match: { unit: 'hp', min: 5 }, points: 15 });
    const kw = rule({ factor: 'system_size', match: { unit: 'kw', max: 3 }, points: 15 });
    expect(scoreLead(lead(), [hp, kw], NOW).score).toBe(65);
    expect(scoreLead(lead({ systemSize: { kw: 3, hp: null } }), [hp, kw], NOW).score).toBe(65);
    expect(scoreLead(lead({ systemSize: { kw: null, hp: null } }), [hp, kw], NOW).score).toBe(50);
  });

  it('ignores a rule whose match cannot be read', () => {
    const broken = [
      rule({ factor: 'source', match: { codes: ['walk_in'] } }),
      rule({ factor: 'age_days', match: {} }),
      rule({ factor: 'system_size', match: { unit: 'kw', min: 9, max: 1 } }),
      rule({ factor: 'segment', match: null }),
    ];
    expect(scoreLead(lead(), broken, NOW)).toEqual({ score: 50, reasons: [] });
  });

  it('holds the score at 0 and 100 but keeps every reason', () => {
    const match = { sourceCodes: ['walk_in'] };
    const up = [1, 2, 3].map(() => rule({ factor: 'source', match, points: 50 }));
    const down = [1, 2, 3].map(() => rule({ factor: 'source', match, points: -50 }));
    expect(scoreLead(lead(), up, NOW)).toMatchObject({ score: 100 });
    expect(scoreLead(lead(), up, NOW).reasons).toHaveLength(3);
    expect(scoreLead(lead(), down, NOW)).toMatchObject({ score: 0 });
  });
});

const SEGMENTS_FOR_TESTS = SegmentSchema.options;

describe('scoreLead properties (seeded random leads and rules)', () => {
  const FACTORS = ['source', 'segment', 'district', 'system_size', 'age_days'] as const;
  const SOURCES = ['walk_in', 'missed_call', 'meta_ads', 'website'];
  const DISTRICTS = ['Nashik', 'Pune', 'Jalgaon'];

  function randomCase(random: () => number): { facts: ScoreFacts; rules: ScoreRule[] } {
    const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
    const facts = lead({
      entityId: 1 + Math.floor(random() * 4),
      segment: pick(SEGMENTS_FOR_TESTS),
      sourceCode: random() < 0.2 ? null : pick(SOURCES),
      district: random() < 0.2 ? null : pick(DISTRICTS),
      systemSize: {
        kw: random() < 0.5 ? null : random() * 20,
        hp: random() < 0.5 ? null : random() * 15,
      },
      createdAt: new Date(NOW.getTime() - Math.floor(random() * 60) * DAY),
    });
    const rules = Array.from({ length: Math.floor(random() * 12) }, (): ScoreRule => {
      const factor = pick(FACTORS);
      const match =
        factor === 'source'
          ? { sourceCodes: [pick(SOURCES)] }
          : factor === 'segment'
            ? { segments: [pick(SEGMENTS_FOR_TESTS)] }
            : factor === 'district'
              ? { districts: [pick(DISTRICTS)] }
              : factor === 'system_size'
                ? { unit: pick(['kw', 'hp'] as const), min: Math.floor(random() * 10) }
                : { maxDays: Math.floor(random() * 30) };
      let points = Math.floor(random() * 101) - 50;
      if (points === 0) points = 1;
      return {
        entityId: random() < 0.5 ? null : 1 + Math.floor(random() * 4),
        segment: random() < 0.6 ? null : pick(SEGMENTS_FOR_TESTS),
        factor,
        match,
        points,
      };
    });
    return { facts, rules };
  }

  it('always answers a whole score from 0 to 100', () => {
    const random = seeded(31);
    for (let i = 0; i < 2000; i++) {
      const { facts, rules } = randomCase(random);
      const { score } = scoreLead(facts, rules, NOW);
      expect(Number.isInteger(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it('equals the base plus its reasons, held between 0 and 100', () => {
    const random = seeded(37);
    for (let i = 0; i < 2000; i++) {
      const { facts, rules } = randomCase(random);
      const { score, reasons } = scoreLead(facts, rules, NOW);
      const sum = reasons.reduce((total, r) => total + r.points, 50);
      expect(score).toBe(Math.min(100, Math.max(0, sum)));
      expect(reasons.length).toBeLessThanOrEqual(rules.length);
    }
  });

  it('does not depend on rules for other companies or segments', () => {
    const random = seeded(41);
    for (let i = 0; i < 1000; i++) {
      const { facts, rules } = randomCase(random);
      const own = rules.filter(
        (r) =>
          (r.entityId === null || r.entityId === facts.entityId) &&
          (r.segment === null || r.segment === facts.segment),
      );
      expect(scoreLead(facts, rules, NOW)).toEqual(scoreLead(facts, own, NOW));
    }
  });

  it('is deterministic for the same lead, rules and time', () => {
    const random = seeded(43);
    for (let i = 0; i < 500; i++) {
      const { facts, rules } = randomCase(random);
      expect(scoreLead(facts, rules, NOW)).toEqual(scoreLead({ ...facts }, [...rules], NOW));
    }
  });

  it('never lowers the score when a rule with positive points is added', () => {
    const random = seeded(47);
    for (let i = 0; i < 1000; i++) {
      const { facts, rules } = randomCase(random);
      const bonus: ScoreRule = {
        entityId: null,
        segment: null,
        factor: 'segment',
        match: { segments: [facts.segment] },
        points: 1 + Math.floor(random() * 50),
      };
      expect(scoreLead(facts, [...rules, bonus], NOW).score).toBeGreaterThanOrEqual(
        scoreLead(facts, rules, NOW).score,
      );
    }
  });
});
