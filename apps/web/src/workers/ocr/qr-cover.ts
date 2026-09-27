// Finding every QR code on a customer's document photo so it can be covered (BLUEPRINT §7.5,
// SECURITY.md §5, docs/spikes/ocr.md). Older Aadhaar cards and e-Aadhaar letters carry a QR
// code that can hold the full number, so every code is covered whatever it holds: its payload
// is dropped as soon as the code is located and is never kept, compared or logged.
//
// Pure: works on pixels in memory. Two ways of locating a code:
// 1. Decoding it with jsQR, on the whole photo, a smaller and a larger copy, and overlapping
//    tiles so a small code in a corner is found too. Each located code is painted out of the
//    working copy and the pass repeats, so a second code on the same photo is found.
// 2. Finding the three square finder marks of a code jsQR could not decode (blurred, torn,
//    partly shaded). Three marks at the corners of a square locate the code as well; a finder
//    mark that belongs to no such square is counted as `uncovered`, since a code may be there.
import jsQR from 'jsqr';
import type { Box } from './plan-masks';

/** RGBA pixels, four bytes each, as sharp's raw output gives them. */
export interface Raster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface QrScan {
  /** Rectangles to cover, in the photo's pixels, the safety margin included. */
  boxes: Box[];
  /** Codes located by decoding them. */
  decoded: number;
  /** Codes located from their three finder marks without decoding. */
  estimated: number;
  /** Finder marks left over after covering: a code may be there that is not covered. */
  uncovered: number;
}

/** One-channel copy of the photo. */
interface Gray {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

// The margin around a located code: its quiet zone (four modules) plus a tenth of its side,
// and never less than a few pixels, so a slightly misplaced corner still leaves nothing to read.
const QUIET_MODULES = 4;
const SAFETY_SHARE = 0.1;
const MIN_MARGIN_PX = 8;
// Cap on codes decoded in one pass (a photo holds one or two; the cap stops a loop).
const MAX_CODES_PER_PASS = 6;

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The rectangle to cover for a code with these four outer corners and `dimension` modules a
 * side: the corners' bounding box widened by the quiet zone and the safety margin, kept inside
 * the photo.
 */
export function qrCoverBox(
  corners: readonly Point[],
  dimension: number,
  bounds: { width: number; height: number },
): Box {
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  // Corners in order around the code: the first to the second and the first to the last are sides.
  const [a, b] = corners;
  const d = corners.at(-1);
  const side = a && b && d ? Math.max(distance(a, b), distance(a, d)) : 0;
  const module = side / Math.max(1, dimension);
  const margin = Math.max(MIN_MARGIN_PX, QUIET_MODULES * module + SAFETY_SHARE * side);
  return {
    x0: Math.max(0, Math.floor(Math.min(...xs) - margin)),
    y0: Math.max(0, Math.floor(Math.min(...ys) - margin)),
    x1: Math.min(bounds.width, Math.ceil(Math.max(...xs) + margin)),
    y1: Math.min(bounds.height, Math.ceil(Math.max(...ys) + margin)),
  };
}

/**
 * The outer corners of a code from the centres of its three finder marks (`corner` is the one
 * at the right angle) and its module size: the fourth corner completes the square, and each
 * corner lies 3.5 modules beyond its finder centre, away from the code's middle.
 */
export function cornersFromFinders(
  corner: Point,
  b: Point,
  c: Point,
  module: number,
): { corners: Point[]; dimension: number } {
  const d = { x: b.x + c.x - corner.x, y: b.y + c.y - corner.y };
  const middle = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
  const dimension = (distance(corner, b) + distance(corner, c)) / 2 / module + 7;
  const stretch = dimension / 2 / Math.max(0.5, dimension / 2 - 3.5);
  const corners = [corner, b, d, c].map((p) => ({
    x: middle.x + (p.x - middle.x) * stretch,
    y: middle.y + (p.y - middle.y) * stretch,
  }));
  return { corners, dimension };
}

function toGray(image: Raster): Gray {
  const { width, height, data } = image;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = (data[i * 4]! * 54 + data[i * 4 + 1]! * 183 + data[i * 4 + 2]! * 19) >> 8;
  }
  return { data: gray, width, height };
}

/** Copies the part of `source` inside `crop`, resized by `scale`, averaging when shrinking. */
export function view(source: Gray, crop: Box, scale: number): Gray {
  const cw = crop.x1 - crop.x0;
  const ch = crop.y1 - crop.y0;
  const width = Math.max(1, Math.round(cw * scale));
  const height = Math.max(1, Math.round(ch * scale));
  const out = new Uint8ClampedArray(width * height);
  const step = 1 / scale;
  for (let y = 0; y < height; y++) {
    const sy0 = crop.y0 + Math.floor(y * step);
    const sy1 = Math.min(crop.y1, Math.max(sy0 + 1, crop.y0 + Math.floor((y + 1) * step)));
    for (let x = 0; x < width; x++) {
      const sx0 = crop.x0 + Math.floor(x * step);
      const sx1 = Math.min(crop.x1, Math.max(sx0 + 1, crop.x0 + Math.floor((x + 1) * step)));
      let sum = 0;
      let count = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        const row = sy * source.width;
        for (let sx = sx0; sx < sx1; sx++) {
          sum += source.data[row + sx]!;
          count += 1;
        }
      }
      out[y * width + x] = count > 0 ? sum / count : 255;
    }
  }
  return { data: out, width, height };
}

function toRgba(gray: Gray): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(gray.data.length * 4);
  for (let i = 0; i < gray.data.length; i++) {
    const v = gray.data[i]!;
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

/** Paints `box` white on the working copy, so the code it covers is not found again. */
function paint(gray: Gray, box: Box): void {
  for (let y = Math.max(0, box.y0); y < Math.min(gray.height, box.y1); y++) {
    gray.data.fill(255, y * gray.width + Math.max(0, box.x0), y * gray.width + Math.min(gray.width, box.x1));
  }
}

interface Pass {
  crop: Box;
  scale: number;
}

/** The whole photo, a smaller and a larger copy, and overlapping tiles for small codes. */
function passesFor(width: number, height: number): Pass[] {
  const whole = { x0: 0, y0: 0, x1: width, y1: height };
  const longest = Math.max(width, height);
  const passes: Pass[] = [{ crop: whole, scale: 1 }];
  if (longest > 1300) passes.push({ crop: whole, scale: 1000 / longest });
  const tileScale = longest < 1600 ? 2 : 1;
  if (tileScale > 1) passes.push({ crop: whole, scale: tileScale });
  // Nine tiles, each half the photo a side, overlapping by half.
  const tw = Math.ceil(width / 2);
  const th = Math.ceil(height / 2);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const x0 = Math.min(width - tw, Math.round((col * width) / 4));
      const y0 = Math.min(height - th, Math.round((row * height) / 4));
      passes.push({ crop: { x0, y0, x1: x0 + tw, y1: y0 + th }, scale: tileScale });
    }
  }
  return passes;
}

/** Locates codes by decoding them; their payload is wiped and dropped at once. */
function decodeCodes(work: Gray, pass: Pass, boxes: Box[]): number {
  let found = 0;
  for (let i = 0; i < MAX_CODES_PER_PASS; i++) {
    const pixels = view(work, pass.crop, pass.scale);
    const rgba = toRgba(pixels);
    const code = jsQR(rgba, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' });
    rgba.fill(0);
    pixels.data.fill(0);
    if (!code) break;
    // The payload may hold the full Aadhaar number: never keep, compare or log it.
    code.binaryData.fill(0);
    const { location } = code;
    const toPhoto = (p: Point): Point => ({
      x: pass.crop.x0 + p.x / pass.scale,
      y: pass.crop.y0 + p.y / pass.scale,
    });
    const corners = [
      location.topLeftCorner,
      location.topRightCorner,
      location.bottomRightCorner,
      location.bottomLeftCorner,
    ].map(toPhoto);
    const box = qrCoverBox(corners, 17 + 4 * code.version, work);
    boxes.push(box);
    paint(work, box);
    found += 1;
  }
  return found;
}

export interface FinderMark {
  x: number;
  y: number;
  /** Module size in pixels. */
  module: number;
  /** Scan lines that crossed the mark. */
  hits: number;
}

/** Dark (1) or light (0) per pixel against the mean of a window around it. */
function binarize(gray: Gray): Uint8Array {
  const { width, height, data } = gray;
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += data[y * width + x]!;
      integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1]! + rowSum;
    }
  }
  const half = Math.max(20, Math.round(Math.min(width, height) / 12));
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(height, y + half + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(width, x + half + 1);
      const sum =
        integral[y1 * (width + 1) + x1]! -
        integral[y0 * (width + 1) + x1]! -
        integral[y1 * (width + 1) + x0]! +
        integral[y0 * (width + 1) + x0]!;
      const mean = sum / ((x1 - x0) * (y1 - y0));
      out[y * width + x] = data[y * width + x]! < mean * 0.85 ? 1 : 0;
    }
  }
  integral.fill(0);
  return out;
}

/** Whether five runs read dark, light, dark, light, dark in the ratio 1:1:3:1:1. */
function finderRatio(runs: readonly number[]): number | undefined {
  const total = runs.reduce((a, b) => a + b, 0);
  if (total < 9) return undefined;
  const unit = total / 7;
  const slack = unit / 2;
  const ok =
    Math.abs(unit - runs[0]!) < slack &&
    Math.abs(unit - runs[1]!) < slack &&
    Math.abs(3 * unit - runs[2]!) < 3 * slack &&
    Math.abs(unit - runs[3]!) < slack &&
    Math.abs(unit - runs[4]!) < slack;
  return ok ? unit : undefined;
}

/** Runs through (cx, cy) along direction (dx, dy): the five runs of a finder mark, or none. */
function crossRuns(
  bin: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  limit: number,
): number[] | undefined {
  const at = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height ? bin[y * width + x]! : 0;
  if (at(cx, cy) !== 1) return undefined;
  const walk = (sx: number, sy: number): number[] | undefined => {
    // From the centre outwards: dark (the middle square), light, dark.
    const counts = [0, 0, 0];
    let x = cx;
    let y = cy;
    for (const [index, colour] of [
      [0, 1],
      [1, 0],
      [2, 1],
    ] as const) {
      while (at(x, y) === colour && counts[index]! <= limit) {
        counts[index]! += 1;
        x += sx;
        y += sy;
      }
      if (counts[index] === 0 || counts[index]! > limit) return undefined;
    }
    return counts;
  };
  const forward = walk(dx, dy);
  const backward = walk(-dx, -dy);
  if (!forward || !backward) return undefined;
  return [backward[2]!, backward[1]!, backward[0]! + forward[0]! - 1, forward[1]!, forward[2]!];
}

/** The square finder marks on the photo, found along rows and checked across and diagonally. */
export function findFinderMarks(gray: Gray): FinderMark[] {
  const { width, height } = gray;
  const bin = binarize(gray);
  const marks: FinderMark[] = [];
  const runs: number[] = [];
  for (let y = 0; y < height; y++) {
    runs.length = 0;
    let colour = 0;
    let length = 0;
    let x = 0;
    const flush = (end: number) => {
      runs.push(length);
      // Five runs ending in a dark one, starting with a dark one.
      if (colour === 1 && runs.length >= 5) {
        const five = runs.slice(-5);
        const unit = finderRatio(five);
        if (unit !== undefined) {
          const cx = Math.round(end - five[4]! - five[3]! - five[2]! / 2);
          check(cx, y, unit);
        }
      }
    };
    for (x = 0; x < width; x++) {
      const v = bin[y * width + x]!;
      if (v === colour) length += 1;
      else {
        if (length > 0) flush(x);
        colour = v;
        length = 1;
      }
    }
    if (length > 0) flush(x);
  }
  bin.fill(0);

  function check(cx: number, cy: number, unit: number): void {
    const limit = Math.ceil(unit * 5);
    const vertical = crossRuns(bin, width, height, cx, cy, 0, 1, limit);
    if (!vertical) return;
    const vUnit = finderRatio(vertical);
    if (vUnit === undefined || vUnit / unit < 0.6 || vUnit / unit > 1.6) return;
    const diagonal = crossRuns(bin, width, height, cx, cy, 1, 1, limit);
    if (!diagonal || finderRatio(diagonal) === undefined) return;
    const module = (unit + vUnit) / 2;
    const near = marks.find(
      (m) =>
        Math.hypot(m.x - cx, m.y - cy) < module * 2.5 &&
        m.module / module < 2 &&
        module / m.module < 2,
    );
    if (near) {
      near.x = (near.x * near.hits + cx) / (near.hits + 1);
      near.y = (near.y * near.hits + cy) / (near.hits + 1);
      near.module = (near.module * near.hits + module) / (near.hits + 1);
      near.hits += 1;
    } else {
      marks.push({ x: cx, y: cy, module, hits: 1 });
    }
  }
  return marks.filter((m) => m.hits >= 2);
}

interface Triple {
  corner: FinderMark;
  b: FinderMark;
  c: FinderMark;
  error: number;
}

/** How well three marks sit at three corners of a square code, with `corner` at the right angle. */
function asTriple(corner: FinderMark, b: FinderMark, c: FinderMark): Triple | undefined {
  const modules = [corner.module, b.module, c.module];
  if (Math.max(...modules) / Math.min(...modules) > 1.6) return undefined;
  const module = (corner.module + b.module + c.module) / 3;
  const d1 = distance(corner, b);
  const d2 = distance(corner, c);
  const hypotenuse = distance(b, c);
  const sides = Math.min(d1, d2) / Math.max(d1, d2);
  const square = Math.abs(hypotenuse - Math.hypot(d1, d2)) / hypotenuse;
  const span = (d1 + d2) / 2 / module;
  // Codes run from 21 modules a side (14 between finder centres) to 177 (170).
  if (sides < 0.75 || square > 0.12 || span < 10 || span > 180) return undefined;
  return { corner, b, c, error: 1 - sides + square };
}

/** Groups finder marks into codes; returns the codes and the marks that fit none. */
export function groupFinderMarks(marks: readonly FinderMark[]): {
  codes: Triple[];
  loose: FinderMark[];
} {
  const free = new Set(marks);
  const codes: Triple[] = [];
  for (;;) {
    const list = [...free];
    let best: Triple | undefined;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        for (let k = j + 1; k < list.length; k++) {
          const [p, q, r] = [list[i]!, list[j]!, list[k]!];
          for (const t of [asTriple(p, q, r), asTriple(q, p, r), asTriple(r, p, q)]) {
            if (t && (!best || t.error < best.error)) best = t;
          }
        }
      }
    }
    if (!best) break;
    codes.push(best);
    free.delete(best.corner);
    free.delete(best.b);
    free.delete(best.c);
  }
  return { codes, loose: [...free] };
}

/**
 * Every QR code on the photo, as rectangles to cover. `image` is read, not changed; every
 * working copy is zeroed before this returns.
 */
export function scanQrCodes(image: Raster): QrScan {
  const work = toGray(image);
  const bounds = { width: image.width, height: image.height };
  const boxes: Box[] = [];
  let decoded = 0;
  for (const pass of passesFor(image.width, image.height)) decoded += decodeCodes(work, pass, boxes);

  const { codes, loose } = groupFinderMarks(findFinderMarks(work));
  work.data.fill(0);
  for (const code of codes) {
    const module = (code.corner.module + code.b.module + code.c.module) / 3;
    const { corners, dimension } = cornersFromFinders(code.corner, code.b, code.c, module);
    boxes.push(qrCoverBox(corners, dimension, bounds));
  }
  return { boxes, decoded, estimated: codes.length, uncovered: loose.length };
}
