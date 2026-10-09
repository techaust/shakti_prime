import type { ConvertingLeadDto } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import {
  converterHref,
  convertingShortcut,
  groupByStage,
  leadKey,
  movedIndex,
  panelsFor,
  sizingKindFor,
} from './converting';

const key = (k: string, extra: object = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...extra,
});

describe('convertingShortcut', () => {
  it('maps each key of the workspace, in either case', () => {
    expect(convertingShortcut(key('/'))).toEqual({ kind: 'search' });
    expect(convertingShortcut(key('?'))).toEqual({ kind: 'help' });
    expect(convertingShortcut(key('j'))).toEqual({ kind: 'move', step: 1 });
    expect(convertingShortcut(key('K'))).toEqual({ kind: 'move', step: -1 });
    expect(convertingShortcut(key('n'))).toEqual({ kind: 'next' });
    expect(convertingShortcut(key('L'))).toEqual({ kind: 'log' });
    expect(convertingShortcut(key('c'))).toEqual({ kind: 'callback' });
    expect(convertingShortcut(key('S'))).toEqual({ kind: 'sizing' });
    expect(convertingShortcut(key('q'))).toEqual({ kind: 'quote' });
    expect(convertingShortcut(key('D'))).toEqual({ kind: 'dial' });
    expect(convertingShortcut(key('7'))).toEqual({ kind: 'outcome', key: 7 });
  });

  it('leaves other keys, zero and keys with a modifier held to the browser', () => {
    expect(convertingShortcut(key('0'))).toBeUndefined();
    expect(convertingShortcut(key('Enter'))).toBeUndefined();
    expect(convertingShortcut(key('x'))).toBeUndefined();
    expect(convertingShortcut(key('s', { ctrlKey: true }))).toBeUndefined();
    expect(convertingShortcut(key('k', { metaKey: true }))).toBeUndefined();
    expect(convertingShortcut(key('l', { altKey: true }))).toBeUndefined();
  });
});

function lead(over: Partial<ConvertingLeadDto>): ConvertingLeadDto {
  return {
    opportunityId: 'a',
    entityId: 1,
    accountId: 'x',
    customerName: 'A',
    village: null,
    segment: 'farmer_pumps',
    pipelineName: 'Farmer Pumps',
    stageId: 's',
    stageKey: 'qualified',
    stageName: 'Qualified',
    stagePosition: 3,
    needsQuote: true,
    state: 'open',
    score: 0,
    stageSince: '2030-01-01T00:00:00.000Z',
    nextCall: null,
    sizing: 'none',
    size: null,
    quote: null,
    heldOrder: null,
    ...over,
  };
}

describe('groupByStage', () => {
  it('groups by the stage key across pipelines, earliest stage first, keeping the order read', () => {
    const groups = groupByStage([
      lead({ opportunityId: '1', stageKey: 'quoted', stageName: 'Quoted', stagePosition: 4 }),
      lead({ opportunityId: '2' }),
      lead({
        opportunityId: '3',
        pipelineName: 'Residential Rooftop',
        stagePosition: 2,
        stageName: 'Qualified',
      }),
      lead({ opportunityId: '4', stageKey: 'new', stageName: 'New', stagePosition: 1 }),
    ]);
    expect(groups.map((g) => [g.key, g.leads.map((l) => l.opportunityId)])).toEqual([
      ['new', ['4']],
      ['qualified', ['2', '3']],
      ['quoted', ['1']],
    ]);
  });

  it('is empty for no leads', () => {
    expect(groupByStage([])).toEqual([]);
  });
});

describe('movedIndex', () => {
  it('lands on the first lead when none is chosen', () => {
    expect(movedIndex(3, -1, 1)).toBe(0);
    expect(movedIndex(3, -1, -1)).toBe(0);
  });
  it('steps and stops at the ends', () => {
    expect(movedIndex(3, 0, 1)).toBe(1);
    expect(movedIndex(3, 2, 1)).toBe(2);
    expect(movedIndex(3, 1, -1)).toBe(0);
    expect(movedIndex(3, 0, -1)).toBe(0);
  });
  it('does nothing without leads', () => {
    expect(movedIndex(0, -1, 1)).toBeUndefined();
  });
});

describe('panelsFor and the addresses', () => {
  it('offers the order panel only while an order is held', () => {
    expect(panelsFor(undefined)).toEqual(['calls', 'sizing', 'quote']);
    expect(panelsFor({ heldOrder: null })).toEqual(['calls', 'sizing', 'quote']);
    expect(
      panelsFor({
        heldOrder: { id: 'o', soNo: 'SO', heldAt: '2030-01-01T00:00:00.000Z', grandTotal: '1.00' },
      }),
    ).toEqual(['calls', 'sizing', 'quote', 'order']);
  });

  it('names a lead by company and id, and a converter by person and company', () => {
    expect(leadKey({ entityId: 2, opportunityId: 'abc' })).toBe('2:abc');
    expect(converterHref('p1', 3)).toBe('/converting?owner=p1&company=3');
  });
});

describe('sizingKindFor', () => {
  it('opens the sizing on the kind the business line needs', () => {
    expect(sizingKindFor('farmer_pumps')).toBe('pump');
    expect(sizingKindFor('residential_rooftop')).toBe('rooftop');
    expect(sizingKindFor('commercial_epc')).toBe('rooftop');
    expect(sizingKindFor('dealer_wholesale')).toBe('pump');
  });
});
