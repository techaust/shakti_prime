import { describe, expect, it } from 'vitest';
import {
  buildSizingInput,
  formatQuantity,
  measurement,
  nextTab,
  sizingFields,
} from './sizing';

const LEAD = { entityId: 1, opportunityId: '01990000-0000-7000-8000-000000000001' };

describe('measurement', () => {
  it.each([
    ['30', 30],
    [' 12.5 ', 12.5],
    ['18,000', 18_000],
    ['1,00,000', 100_000],
    ['.5', 0.5],
    ['0', 0],
  ])('reads %j as %d', (typed, value) => {
    expect(measurement(typed)).toBe(value);
  });

  it.each(['', ' ', '-3', '1e3', '12 m', 'abc', '1.2.3', 'Infinity'])(
    'leaves %j out, so the server names the field',
    (typed) => {
      expect(measurement(typed)).toBeUndefined();
    },
  );
});

describe('buildSizingInput', () => {
  it('builds a pump sizing with its choices, its measurements and the chosen pump', () => {
    const values: Record<string, string> = {
      pumpType: 'submersible',
      drive: 'solar',
      pipeMaterial: 'hdpe',
      staticLevelM: '30',
      drawdownM: '5',
      deliveryHeightM: '2',
      pipeLengthM: '50',
      pipeInnerDiameterMm: '50',
      flowLph: '18,000',
      itemId: '01990000-0000-7000-8000-0000000000aa',
    };
    expect(buildSizingInput('pump', LEAD, (name) => values[name] ?? '')).toEqual({
      ...LEAD,
      sizing: {
        kind: 'pump',
        inputs: {
          pumpType: 'submersible',
          drive: 'solar',
          pipeMaterial: 'hdpe',
          staticLevelM: 30,
          drawdownM: 5,
          deliveryHeightM: 2,
          pipeLengthM: 50,
          pipeInnerDiameterMm: 50,
          flowLph: 18_000,
        },
        itemId: '01990000-0000-7000-8000-0000000000aa',
      },
    });
  });

  it('sends no pump when none is chosen and leaves out an empty measurement', () => {
    const input = buildSizingInput('pump', LEAD, (name) => (name === 'drawdownM' ? '4' : ''));
    expect(input).toMatchObject({ sizing: { itemId: null, inputs: { drawdownM: 4 } } });
    expect((input.sizing as { inputs: object }).inputs).not.toHaveProperty('staticLevelM');
  });

  it('builds a rooftop sizing from its three measurements only', () => {
    const values: Record<string, string> = {
      monthlyUnitsKwh: '300',
      roofAreaSqm: '40',
      sanctionedLoadKw: '5',
      itemId: 'ignored',
    };
    expect(buildSizingInput('rooftop', LEAD, (name) => values[name] ?? '')).toEqual({
      ...LEAD,
      sizing: {
        kind: 'rooftop',
        inputs: { monthlyUnitsKwh: 300, roofAreaSqm: 40, sanctionedLoadKw: 5 },
      },
    });
  });
});

describe('sizingFields', () => {
  it('names the failure path of every field each tab shows', () => {
    expect(sizingFields('rooftop')).toEqual([
      'sizing.inputs.monthlyUnitsKwh',
      'sizing.inputs.roofAreaSqm',
      'sizing.inputs.sanctionedLoadKw',
    ]);
    expect(sizingFields('pump')).toContain('sizing.inputs.flowLph');
    expect(sizingFields('pump')).toContain('sizing.itemId');
  });
});

describe('formatQuantity', () => {
  it('groups the Indian way and drops trailing zeros', () => {
    expect(formatQuantity(44.3948)).toBe('44.39');
    expect(formatQuantity(7.5)).toBe('7.5');
    expect(formatQuantity(100_000)).toBe('1,00,000');
    expect(formatQuantity(3.72854, 3)).toBe('3.729');
    expect(formatQuantity(0)).toBe('0');
  });
});

describe('nextTab', () => {
  it('steps and wraps with the arrows and jumps with Home and End', () => {
    expect(nextTab(0, 'ArrowRight', 2)).toBe(1);
    expect(nextTab(1, 'ArrowRight', 2)).toBe(0);
    expect(nextTab(0, 'ArrowLeft', 2)).toBe(1);
    expect(nextTab(1, 'Home', 2)).toBe(0);
    expect(nextTab(0, 'End', 2)).toBe(1);
  });

  it('ignores any other key and a row with no tabs', () => {
    expect(nextTab(0, 'ArrowDown', 2)).toBeUndefined();
    expect(nextTab(0, 'Enter', 2)).toBeUndefined();
    expect(nextTab(0, 'ArrowRight', 0)).toBeUndefined();
  });
});
