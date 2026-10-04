import { describe, expect, it } from 'vitest';
import {
  curveNumber,
  curvePath,
  kitQuantity,
  percentFromTyped,
  readCurve,
  specNumber,
} from './catalogue';

describe('curvePath', () => {
  const box = { width: 320, height: 160, inset: 8 };

  it('draws flow across and head up, from the origin to the largest values', () => {
    const path = curvePath(
      [
        { flowLph: '0', headM: '90' },
        { flowLph: '6000', headM: '45' },
      ],
      box,
    );
    expect(path?.dots).toEqual([
      { x: 8, y: 8 },
      { x: 312, y: 80 },
    ]);
    expect(path?.points).toBe('8,8 312,80');
    expect(path).toMatchObject({
      highestHead: '90',
      lowestHead: '45',
      leastFlow: '0',
      mostFlow: '6,000',
    });
  });

  it('draws nothing for fewer than two points or all zero values', () => {
    expect(curvePath([{ flowLph: '100', headM: '10' }], box)).toBeUndefined();
    expect(
      curvePath(
        [
          { flowLph: '0', headM: '0' },
          { flowLph: '0', headM: '0' },
        ],
        box,
      ),
    ).toBeUndefined();
  });
});

describe('specNumber', () => {
  const hp = { key: 'hp', kind: 'number', min: 0.1, max: 1000, decimals: 2 } as const;
  const mm = { key: 'outletMm', kind: 'number', min: 1, max: 1000, decimals: 0 } as const;

  it('reads a number within its range and decimal places, commas allowed', () => {
    expect(specNumber('5', hp)).toBe(5);
    expect(specNumber(' 7.5 ', hp)).toBe(7.5);
    expect(specNumber('0.1', hp)).toBe(0.1);
    expect(specNumber('1,000', hp)).toBe(1000);
    expect(specNumber('65', mm)).toBe(65);
  });

  it('refuses a value outside the range, too many decimals, or anything else', () => {
    expect(specNumber('0.09', hp)).toBeUndefined();
    expect(specNumber('1000.01', hp)).toBeUndefined();
    expect(specNumber('7.555', hp)).toBeUndefined();
    expect(specNumber('65.5', mm)).toBeUndefined();
    expect(specNumber('-5', hp)).toBeUndefined();
    expect(specNumber('5 HP', hp)).toBeUndefined();
    expect(specNumber('', hp)).toBeUndefined();
  });
});

describe('readCurve', () => {
  const rows = (pairs: [string, string][]) => pairs.map(([flow, head]) => ({ flow, head }));

  it('reads 2 to 30 points with flow rising and head falling', () => {
    expect(
      readCurve(
        rows([
          ['0', '90'],
          ['3,000', '80.5'],
          ['6000', '40'],
        ]),
      ),
    ).toEqual({
      ok: true,
      points: [
        { flowLph: '0', headM: '90' },
        { flowLph: '3000', headM: '80.5' },
        { flowLph: '6000', headM: '40' },
      ],
    });
  });

  it('names the first problem: the count, a value, or the order', () => {
    expect(readCurve(rows([['0', '90']]))).toEqual({ ok: false, problem: 'countWrong' });
    const many = Array.from({ length: 31 }, (_, i): [string, string] => [
      String(i),
      String(99 - i),
    ]);
    expect(readCurve(rows(many))).toEqual({ ok: false, problem: 'countWrong' });
    expect(
      readCurve(
        rows([
          ['0', '90'],
          ['', '40'],
        ]),
      ),
    ).toEqual({ ok: false, problem: 'pointWrong' });
    expect(
      readCurve(
        rows([
          ['0', '1234567'],
          ['10', '40'],
        ]),
      ),
    ).toEqual({ ok: false, problem: 'pointWrong' });
    expect(
      readCurve(
        rows([
          ['100', '90'],
          ['100', '40'],
        ]),
      ),
    ).toEqual({ ok: false, problem: 'orderWrong' });
    expect(
      readCurve(
        rows([
          ['100', '40'],
          ['200', '40'],
        ]),
      ),
    ).toEqual({ ok: false, problem: 'orderWrong' });
  });
});

describe('typed values', () => {
  it('reads curve values with up to two decimals and the whole digits their column holds', () => {
    expect(curveNumber('12.25', 6)).toBe('12.25');
    expect(curveNumber('123456', 6)).toBe('123456');
    expect(curveNumber('1234567', 6)).toBeUndefined();
    expect(curveNumber('1234567', 10)).toBe('1234567');
    expect(curveNumber('1.234', 10)).toBeUndefined();
  });

  it('reads a kit quantity above zero with up to three decimals', () => {
    expect(kitQuantity('1')).toBe('1');
    expect(kitQuantity('30.5')).toBe('30.5');
    expect(kitQuantity('0.001')).toBe('0.001');
    expect(kitQuantity('0')).toBeUndefined();
    expect(kitQuantity('1.0001')).toBeUndefined();
    expect(kitQuantity('two')).toBeUndefined();
  });

  it('reads a percentage from 0 to 100 as the tax commands take it', () => {
    expect(percentFromTyped('18')).toBe('18.00');
    expect(percentFromTyped('2.5')).toBe('2.50');
    expect(percentFromTyped('0')).toBe('0.00');
    expect(percentFromTyped('100')).toBe('100.00');
    expect(percentFromTyped('100.01')).toBeUndefined();
    expect(percentFromTyped('18.555')).toBeUndefined();
    expect(percentFromTyped('')).toBeUndefined();
  });
});
