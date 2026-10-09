import { describe, expect, it } from 'vitest';
import { misaligned, type Box } from './alignment';

const box = (
  kind: Box['kind'],
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Box => ({
  kind,
  name,
  x,
  y,
  width,
  height,
});

describe('misaligned', () => {
  it('finds a Search button sitting below its box (Customers, 09-10-2026)', () => {
    // The screenshot's numbers: the box at 221–265, the button at 238–283, 10 px to its right.
    const found = misaligned([
      box('control', 'Find a customer', 330, 221, 480, 44),
      box('action', 'Search', 820, 238, 99, 45),
    ]);
    expect(found).toEqual(['"Search" is 17.5 px below the centre of "Find a customer"']);
  });

  it('passes a button level with its box', () => {
    expect(
      misaligned([
        box('control', 'Find', 0, 100, 400, 36),
        box('action', 'Search', 408, 100, 80, 36),
      ]),
    ).toEqual([]);
  });

  it('allows a pixel or two of rounding', () => {
    expect(
      misaligned([
        box('control', 'Limit', 0, 100, 140, 34),
        box('action', 'Save limit', 148, 101.5, 90, 34),
      ]),
    ).toEqual([]);
  });

  it('leaves alone a button inside a box, one on another line, one far away and a tall box', () => {
    expect(
      misaligned([
        box('control', 'Date', 0, 100, 200, 36),
        box('action', 'Choose a date', 170, 104, 24, 24), // drawn inside the box
        box('action', 'Next', 0, 160, 80, 36), // the line below
        box('action', 'Far', 400, 110, 80, 36), // 200 px away
        box('control', 'Note', 600, 100, 300, 120), // a textarea
        box('action', 'Add note', 908, 140, 90, 36),
      ]),
    ).toEqual([]);
  });

  it('checks a button on the left of its box too', () => {
    expect(
      misaligned([box('action', 'Back', 0, 120, 60, 36), box('control', 'Page', 70, 100, 80, 36)]),
    ).toEqual(['"Back" is 20.0 px below the centre of "Page"']);
  });
});
