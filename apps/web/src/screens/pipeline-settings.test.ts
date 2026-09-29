import { ScoreRuleInput, SetDispositionsInput, SetScoreRulesInput } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import {
  dispositionsInput,
  districtList,
  emptyRule,
  moveItem,
  nextFreeKey,
  outcomeDrafts,
  ruleDraft,
  ruleInput,
  scopeOf,
  scoreRulesInput,
  wholeOrEmpty,
  type RuleDraft,
} from './pipeline-settings';

const ID = '01990000-0000-7000-8000-00000000c301';

describe('moveItem', () => {
  it('moves an item one place and leaves the ends alone', () => {
    expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
    expect(moveItem([], 0, 1)).toEqual([]);
  });
});

describe('wholeOrEmpty and districtList', () => {
  it('reads a whole number, an empty box as none, and anything else as not a number', () => {
    expect(wholeOrEmpty(' 48 ')).toBe(48);
    expect(wholeOrEmpty('-5')).toBe(-5);
    expect(wholeOrEmpty('')).toBeNull();
    expect(wholeOrEmpty('4.5')).toBeNaN();
    expect(wholeOrEmpty('ten')).toBeNaN();
  });

  it('splits districts on commas and lines, once each whatever the case', () => {
    expect(districtList('Nashik, Pune\nnashik,, Jalgaon ')).toEqual(['Nashik', 'Pune', 'Jalgaon']);
    expect(districtList('  ')).toEqual([]);
  });
});

describe('call outcomes', () => {
  it('finds the lowest free number key, and none when all nine are used', () => {
    expect(nextFreeKey([{ key: 1 }, { key: 3 }])).toBe(2);
    expect(nextFreeKey([])).toBe(1);
    expect(nextFreeKey(Array.from({ length: 9 }, (_, i) => ({ key: i + 1 })))).toBeUndefined();
  });

  it('makes an input the contract accepts, keeping stored codes and leaving new ones to the command', () => {
    const drafts = outcomeDrafts([
      {
        id: ID,
        entityId: null,
        segment: null,
        key: 1,
        code: 'interested',
        label: 'Interested',
        nextAction: 'callback',
      },
    ]);
    drafts.push({ rowId: 'new', key: 2, label: '  Site visit booked ', nextAction: 'qualified' });
    const input = dispositionsInput({ entityId: 2, segment: 'farmer_pumps' }, drafts);
    expect(input).toEqual({
      entityId: 2,
      segment: 'farmer_pumps',
      dispositions: [
        { key: 1, code: 'interested', label: 'Interested', nextAction: 'callback' },
        { key: 2, label: 'Site visit booked', nextAction: 'qualified' },
      ],
    });
    expect(SetDispositionsInput.safeParse(input).success).toBe(true);
  });
});

describe('score rules', () => {
  const draft = (over: Partial<RuleDraft>): RuleDraft => ({ ...emptyRule('r'), ...over });

  it('makes a valid rule input for every factor', () => {
    const drafts = [
      draft({ factor: 'source', sourceCodes: ['walk_in'], points: '20' }),
      draft({ factor: 'segment', segments: ['commercial_epc'], points: '-10' }),
      draft({ factor: 'district', districts: 'Nashik, Pune', points: '5' }),
      draft({ factor: 'system_size', unit: 'hp', min: '5', max: '', points: '15' }),
      draft({ factor: 'age_days', min: '', max: '7', points: '8' }),
    ];
    for (const d of drafts) expect(ScoreRuleInput.safeParse(ruleInput(d)).success).toBe(true);
    expect(ruleInput(drafts[3] ?? draft({}))).toEqual({
      factor: 'system_size',
      match: { unit: 'hp', min: 5 },
      points: 15,
    });
    expect(ruleInput(drafts[4] ?? draft({}))).toEqual({
      factor: 'age_days',
      match: { maxDays: 7 },
      points: 8,
    });
  });

  it('leaves wrong values for the contract to refuse rather than guessing', () => {
    for (const d of [
      draft({ points: 'ten', sourceCodes: ['walk_in'] }),
      draft({ points: '0', sourceCodes: ['walk_in'] }),
      draft({ factor: 'age_days', min: '', max: '' }),
      draft({ factor: 'system_size', min: 'big' }),
      draft({ factor: 'source', sourceCodes: [] }),
    ]) {
      expect(ScoreRuleInput.safeParse(ruleInput(d)).success).toBe(false);
    }
  });

  it('shows a stored rule as it was set, and sends it back unchanged', () => {
    const stored = {
      id: ID,
      entityId: 1,
      segment: null,
      factor: 'system_size' as const,
      match: { unit: 'kw', min: 3, max: 10 },
      points: -7,
    };
    const d = ruleDraft(stored);
    expect(d).toMatchObject({
      factor: 'system_size',
      unit: 'kw',
      min: '3',
      max: '10',
      points: '-7',
    });
    expect(ruleInput(d)).toEqual({ factor: 'system_size', match: stored.match, points: -7 });
    const input = scoreRulesInput({ entityId: 1, segment: null }, [d]);
    expect(SetScoreRulesInput.safeParse(input).success).toBe(true);
  });
});

describe('scopeOf', () => {
  it('reads the pickers as the group or a company, and every segment or one', () => {
    expect(scopeOf('group', 'all')).toEqual({ entityId: null, segment: null });
    expect(scopeOf('3', 'dealer_wholesale')).toEqual({ entityId: 3, segment: 'dealer_wholesale' });
  });
});
