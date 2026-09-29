// The catalogue screens' pure rules: the pump curve as a drawn line, and the item, curve and kit
// forms' reading of what was typed. The server checks everything again (`@shakti/contracts`).

import type { SpecField } from '@shakti/contracts';

export interface CurvePoint {
  flowLph: string;
  headM: string;
}

export interface CurvePath {
  /** `x,y x,y …` for an SVG polyline, flow across and head up. */
  points: string;
  dots: { x: number; y: number }[];
  highestHead: string;
  lowestHead: string;
  leastFlow: string;
  mostFlow: string;
}

const inIndia = (n: number) => n.toLocaleString('en-IN');

/**
 * The curve inside a `width` × `height` box, `inset` from each edge: flow from zero at the left to
 * the most flow at the right, head from zero at the bottom to the highest head at the top.
 * Undefined for fewer than two points, which make no line.
 */
export function curvePath(
  curve: readonly CurvePoint[],
  box: { width: number; height: number; inset: number },
): CurvePath | undefined {
  if (curve.length < 2) return undefined;
  const flows = curve.map((p) => Number(p.flowLph));
  const heads = curve.map((p) => Number(p.headM));
  const mostFlow = Math.max(...flows);
  const highestHead = Math.max(...heads);
  if (!(mostFlow > 0) || !(highestHead > 0)) return undefined;
  const spanX = box.width - 2 * box.inset;
  const spanY = box.height - 2 * box.inset;
  const round = (n: number) => Math.round(n * 10) / 10;
  const dots = curve.map((p) => ({
    x: round(box.inset + (Number(p.flowLph) / mostFlow) * spanX),
    y: round(box.height - box.inset - (Number(p.headM) / highestHead) * spanY),
  }));
  return {
    points: dots.map((d) => `${String(d.x)},${String(d.y)}`).join(' '),
    dots,
    highestHead: inIndia(highestHead),
    lowestHead: inIndia(Math.min(...heads)),
    leastFlow: inIndia(Math.min(...flows)),
    mostFlow: inIndia(mostFlow),
  };
}

/**
 * A number typed into a specification field, within its range and decimal places, or undefined.
 * Commas as thousands separators are allowed; anything else that is not a plain number is not.
 */
export function specNumber(
  typed: string,
  field: Extract<SpecField, { kind: 'number' }>,
): number | undefined {
  const plain = typed.trim().replaceAll(',', '');
  const pattern = field.decimals === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${String(field.decimals)}})?$`);
  if (!pattern.test(plain)) return undefined;
  const value = Number(plain);
  return value >= field.min && value <= field.max ? value : undefined;
}

/**
 * A curve value typed with up to two decimal places, commas allowed: flow has up to ten whole
 * digits (`numeric(12,2)`), head up to six (`numeric(8,2)`).
 */
export function curveNumber(typed: string, wholeDigits: 6 | 10): string | undefined {
  const plain = typed.trim().replaceAll(',', '');
  const pattern = new RegExp(`^\\d{1,${String(wholeDigits)}}(\\.\\d{1,2})?$`);
  return pattern.test(plain) ? plain : undefined;
}

export type CurveProblem = 'pointWrong' | 'orderWrong' | 'countWrong';

/** The typed curve as the command takes it, or the first problem with it. */
export function readCurve(
  rows: readonly { flow: string; head: string }[],
): { ok: true; points: CurvePoint[] } | { ok: false; problem: CurveProblem } {
  if (rows.length < 2 || rows.length > 30) return { ok: false, problem: 'countWrong' };
  const points: CurvePoint[] = [];
  for (const row of rows) {
    const flowLph = curveNumber(row.flow, 10);
    const headM = curveNumber(row.head, 6);
    if (flowLph === undefined || headM === undefined) return { ok: false, problem: 'pointWrong' };
    points.push({ flowLph, headM });
  }
  for (let i = 1; i < points.length; i++) {
    const before = points[i - 1];
    const point = points[i];
    if (before === undefined || point === undefined) continue;
    if (
      Number(point.flowLph) <= Number(before.flowLph) ||
      Number(point.headM) >= Number(before.headM)
    ) {
      return { ok: false, problem: 'orderWrong' };
    }
  }
  return { ok: true, points };
}

/** A kit quantity typed with up to three decimal places, above zero, or undefined. */
export function kitQuantity(typed: string): string | undefined {
  const plain = typed.trim();
  return /^\d{1,9}(\.\d{1,3})?$/.test(plain) && Number(plain) > 0 ? plain : undefined;
}

/** A percentage typed as `18` or `18.5`, from 0 to 100, as the tax commands take it (`18.50`). */
export function percentFromTyped(typed: string): string | undefined {
  const plain = typed.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(plain)) return undefined;
  const value = Number(plain);
  return value <= 100 ? value.toFixed(2) : undefined;
}
