// Finding every QR code on a customer's document photo so it can be covered (BLUEPRINT §7.5,
// SECURITY.md §5, docs/spikes/ocr.md). Older Aadhaar cards and e-Aadhaar letters carry a QR
// code that can hold the full number, so every code is covered whatever it holds: its payload
// is wiped as soon as the code is located and is never kept, compared or logged.
//
// Pure: works on pixels in memory. Two ways of locating a code:
// 1. Decoding it with jsQR: first on the photo, or on a copy at most 1000 px long when it is
//    large; then, wherever finder marks (dark on light or light on dark) are still left, on the
//    whole photo at full size and on each overlapping tile that holds a mark (enlarged on a
//    small photo), so a small code in a corner is found too. Each located code is painted out
//    of the working copy and the pass repeats, so a second code on the same photo is found.
// 2. Finding the three square finder marks of a code jsQR could not decode (blurred, torn,
//    partly shaded). Three marks at the corners of a square locate the code as well; a finder
//    mark that belongs to no such square is counted as `uncovered`, since a code may be there.
//
// The full-size and tile passes run only where finder marks are left because jsQR is slow on a
// large photo full of text (seconds a pass) and finds nothing there; the finder scan sees marks
// from about 1.3 px a module, and the first pass reads a clean code on a smaller copy.
import jsQR from 'jsqr';
import type { Box } from './plan-masks';

/** RGBA pixels, four bytes each, as sharp's raw output gives them. */
export interface Raster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** One byte per pixel, dark low. */
export interface Gray {
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

export interface FinderMark {
  x: number;
  y: number;
  /** Size of one module of the code, in pixels. */
  pitch: number;
  /** Scan lines that crossed the mark. */
  hits: number;
}

// The margin around a located code: its quiet zone (four modules) plus a tenth of its side,
// and never less than a few pixels, so a slightly misplaced corner still leaves nothing to read.
const QUIET_MODULES = 4;
const SAFETY_SHARE = 0.1;
const MIN_MARGIN_PX = 8;
// Cap on codes decoded in one pass (a photo holds one or two; the cap stops a loop).
const MAX_CODES_PER_PASS = 6;

/** Typed-array read that satisfies the unchecked-index rule; out of range reads as 0. */
function at(array: ArrayLike<number>, index: number): number {
  return array[index] ?? 0;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The rectangle to cover for a code with these four outer corners (in order around the code)
 * and `dimension` modules a side: the corners' bounding box widened by the quiet zone and the
 * safety margin, kept inside the photo.
 */
export function qrCoverBox(
  corners: readonly Point[],
  dimension: number,
  bounds: { width: number; height: number },
): Box {
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const [a, b] = corners;
  const d = corners.at(-1);
  const side = a && b && d ? Math.max(distance(a, b), distance(a, d)) : 0;
  const pitch = side / Math.max(1, dimension);
  const margin = Math.max(MIN_MARGIN_PX, QUIET_MODULES * pitch + SAFETY_SHARE * side);
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
  return {
    x0: clamp(Math.floor(Math.min(...xs) - margin), bounds.width),
    y0: clamp(Math.floor(Math.min(...ys) - margin), bounds.height),
    x1: clamp(Math.ceil(Math.max(...xs) + margin), bounds.width),
    y1: clamp(Math.ceil(Math.max(...ys) + margin), bounds.height),
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
  pitch: number,
): { corners: Point[]; dimension: number } {
  const d = { x: b.x + c.x - corner.x, y: b.y + c.y - corner.y };
  const middle = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
  const dimension = (distance(corner, b) + distance(corner, c)) / 2 / pitch + 7;
  const stretch = dimension / 2 / Math.max(0.5, dimension / 2 - 3.5);
  const corners = [corner, b, d, c].map((p) => ({
    x: middle.x + (p.x - middle.x) * stretch,
    y: middle.y + (p.y - middle.y) * stretch,
  }));
  return { corners, dimension };
}

export function toGray(image: Raster): Gray {
  const { width, height, data } = image;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = (at(data, i * 4) * 54 + at(data, i * 4 + 1) * 183 + at(data, i * 4 + 2) * 19) >> 8;
  }
  return { data: gray, width, height };
}

/** Copies the part of `source` inside `crop`, resized by `scale`, averaging when shrinking. */
function view(source: Gray, crop: Box, scale: number): Gray {
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
          sum += at(source.data, row + sx);
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
    const v = at(gray.data, i);
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

/** Paints `box` white on the working copy, so the code it covers is not found again. */
function paint(gray: Gray, box: Box): void {
  const x0 = Math.max(0, box.x0);
  const x1 = Math.min(gray.width, box.x1);
  for (let y = Math.max(0, box.y0); y < Math.min(gray.height, box.y1); y++) {
    gray.data.fill(255, y * gray.width + x0, y * gray.width + x1);
  }
}

interface Pass {
  crop: Box;
  scale: number;
  /** Also try light-on-dark codes (doubles the time of a pass that finds nothing). */
  invert: boolean;
}

// A photo at most this long is read at full size from the start, and its tiles enlarged.
const SMALL_PHOTO_PX = 1300;
// The longest side of the first, quick copy of a larger photo.
const QUICK_COPY_PX = 1000;

/**
 * Nine tiles, each half the photo a side and overlapping by half, enlarged on a small photo:
 * a small code in a corner is found here when the whole photo does not show it. A code up to a
 * quarter of the photo a side lies wholly inside a tile that holds any point of it.
 */
function tilePasses(width: number, height: number): Pass[] {
  const scale = Math.max(width, height) <= SMALL_PHOTO_PX ? 2 : 1;
  const tw = Math.ceil(width / 2);
  const th = Math.ceil(height / 2);
  const passes: Pass[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const x0 = Math.min(width - tw, Math.round((col * width) / 4));
      const y0 = Math.min(height - th, Math.round((row * height) / 4));
      passes.push({ crop: { x0, y0, x1: x0 + tw, y1: y0 + th }, scale, invert: true });
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
    const code = jsQR(rgba, pixels.width, pixels.height, {
      inversionAttempts: pass.invert ? 'attemptBoth' : 'dontInvert',
    });
    rgba.fill(0);
    pixels.data.fill(0);
    if (!code) break;
    // The payload may hold the full Aadhaar number: never keep, compare or log it. The byte
    // copies are wiped; the strings go out of reach with `code` when this iteration ends.
    code.binaryData.fill(0);
    for (const chunk of code.chunks) if ('bytes' in chunk) chunk.bytes.fill(0);
    code.chunks.length = 0;
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

/** Dark (1) or light (0) per pixel against the mean of a window around it. */
function binarize(gray: Gray): Uint8Array {
  const { width, height, data } = gray;
  const stride = width + 1;
  const integral = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += at(data, y * width + x);
      integral[(y + 1) * stride + x + 1] = at(integral, y * stride + x + 1) + rowSum;
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
        at(integral, y1 * stride + x1) -
        at(integral, y0 * stride + x1) -
        at(integral, y1 * stride + x0) +
        at(integral, y0 * stride + x0);
      const mean = sum / ((x1 - x0) * (y1 - y0));
      out[y * width + x] = at(data, y * width + x) < mean * 0.85 ? 1 : 0;
    }
  }
  integral.fill(0);
  return out;
}

/** The module size when five runs read dark, light, dark, light, dark as 1:1:3:1:1. */
function finderRatio(runs: readonly number[]): number | undefined {
  if (runs.length !== 5) return undefined;
  const total = runs.reduce((a, b) => a + b, 0);
  if (total < 9) return undefined;
  const unit = total / 7;
  const slack = unit / 2;
  const ok = runs.every((run, i) =>
    i === 2 ? Math.abs(3 * unit - run) < 3 * slack : Math.abs(unit - run) < slack,
  );
  return ok ? unit : undefined;
}

/** The five runs of a finder mark through (cx, cy) along (dx, dy), or none. */
function crossRuns(
  bin: Uint8Array,
  width: number,
  height: number,
  centre: Point,
  dx: number,
  dy: number,
  limit: number,
): number[] | undefined {
  const pixel = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height ? at(bin, y * width + x) : 0;
  if (pixel(centre.x, centre.y) !== 1) return undefined;
  // From the centre outwards: dark (the middle square), light, dark.
  const walk = (sx: number, sy: number): number[] | undefined => {
    const counts: number[] = [];
    let x = centre.x;
    let y = centre.y;
    for (const colour of [1, 0, 1]) {
      let count = 0;
      while (pixel(x, y) === colour && count <= limit) {
        count += 1;
        x += sx;
        y += sy;
      }
      if (count === 0 || count > limit) return undefined;
      counts.push(count);
    }
    return counts;
  };
  const forward = walk(dx, dy);
  const backward = walk(-dx, -dy);
  if (!forward || !backward) return undefined;
  const [fMiddle = 0, fLight = 0, fDark = 0] = forward;
  const [bMiddle = 0, bLight = 0, bDark = 0] = backward;
  return [bDark, bLight, bMiddle + fMiddle - 1, fLight, fDark];
}

/** The square finder marks on the photo, found along rows and checked down and diagonally. */
export function findFinderMarks(gray: Gray): FinderMark[] {
  const { width, height } = gray;
  const bin = binarize(gray);
  const marks: FinderMark[] = [];

  const check = (cx: number, cy: number, unit: number): void => {
    const limit = Math.ceil(unit * 5);
    const centre = { x: cx, y: cy };
    const vertical = crossRuns(bin, width, height, centre, 0, 1, limit);
    const vUnit = vertical && finderRatio(vertical);
    if (vUnit === undefined || vUnit / unit < 0.6 || vUnit / unit > 1.6) return;
    const diagonal = crossRuns(bin, width, height, centre, 1, 1, limit);
    if (!diagonal || finderRatio(diagonal) === undefined) return;
    const pitch = (unit + vUnit) / 2;
    const near = marks.find(
      (m) =>
        Math.hypot(m.x - cx, m.y - cy) < pitch * 2.5 && m.pitch / pitch < 2 && pitch / m.pitch < 2,
    );
    if (near) {
      near.x = (near.x * near.hits + cx) / (near.hits + 1);
      near.y = (near.y * near.hits + cy) / (near.hits + 1);
      near.pitch = (near.pitch * near.hits + pitch) / (near.hits + 1);
      near.hits += 1;
    } else {
      marks.push({ x: cx, y: cy, pitch, hits: 1 });
    }
  };

  const runs: number[] = [];
  for (let y = 0; y < height; y++) {
    runs.length = 0;
    let colour = 0;
    let length = 0;
    const close = (end: number) => {
      runs.push(length);
      // The last five runs, when the one just closed is dark: dark, light, dark, light, dark.
      if (colour === 1 && runs.length >= 5) {
        const five = runs.slice(-5);
        const unit = finderRatio(five);
        if (unit !== undefined) {
          const [, , middle = 0, light = 0, dark = 0] = five;
          check(Math.round(end - dark - light - middle / 2), y, unit);
        }
      }
    };
    for (let x = 0; x < width; x++) {
      const v = at(bin, y * width + x);
      if (v === colour) length += 1;
      else {
        if (length > 0) close(x);
        colour = v;
        length = 1;
      }
    }
    if (length > 0) close(width);
  }
  bin.fill(0);
  return marks.filter((m) => m.hits >= 2);
}

interface Triple {
  corner: FinderMark;
  b: FinderMark;
  c: FinderMark;
  error: number;
}

/** How well three marks sit at three corners of a square, with `corner` at the right angle. */
function asTriple(corner: FinderMark, b: FinderMark, c: FinderMark): Triple | undefined {
  const pitches = [corner.pitch, b.pitch, c.pitch];
  if (Math.max(...pitches) / Math.min(...pitches) > 1.6) return undefined;
  const pitch = (corner.pitch + b.pitch + c.pitch) / 3;
  const d1 = distance(corner, b);
  const d2 = distance(corner, c);
  const hypotenuse = distance(b, c);
  const sides = Math.min(d1, d2) / Math.max(d1, d2);
  const square = Math.abs(hypotenuse - Math.hypot(d1, d2)) / hypotenuse;
  const span = (d1 + d2) / 2 / pitch;
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
    for (const [i, p] of list.entries()) {
      for (const [j, q] of list.entries()) {
        if (j <= i) continue;
        for (const [k, r] of list.entries()) {
          if (k <= j) continue;
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

/** Finder marks of dark-on-light codes and, on an inverted copy, of light-on-dark ones. */
function findAllMarks(gray: Gray): { dark: FinderMark[]; light: FinderMark[] } {
  const dark = findFinderMarks(gray);
  const inverted = new Uint8ClampedArray(gray.data.length);
  for (let i = 0; i < inverted.length; i++) inverted[i] = 255 - at(gray.data, i);
  const light = findFinderMarks({ data: inverted, width: gray.width, height: gray.height });
  inverted.fill(0);
  return { dark, light };
}

function inside(point: Point, box: Box): boolean {
  return point.x >= box.x0 && point.x < box.x1 && point.y >= box.y0 && point.y < box.y1;
}

/**
 * Every QR code on the photo, as rectangles to cover. `image` is read, not changed; every
 * working copy is zeroed before this returns.
 */
export function scanQrCodes(image: Raster): QrScan {
  const { width, height } = image;
  const work = toGray(image);
  const bounds = { width, height };
  const whole = { x0: 0, y0: 0, x1: width, y1: height };
  const longest = Math.max(width, height);
  const small = longest <= SMALL_PHOTO_PX;
  const boxes: Box[] = [];
  let decoded = 0;

  // 1. The photo, or a quick copy of a large one: a clean code of any usual size reads here.
  decoded += decodeCodes(
    work,
    { crop: whole, scale: small ? 1 : QUICK_COPY_PX / longest, invert: true },
    boxes,
  );

  // 2. Finder marks left on the photo mean a code not decoded yet: read the whole photo at full
  //    size and every tile holding a mark, then look for marks again.
  let marks = findAllMarks(work);
  let left = [...marks.dark, ...marks.light];
  if (left.length > 0) {
    if (!small) decoded += decodeCodes(work, { crop: whole, scale: 1, invert: true }, boxes);
    for (const pass of tilePasses(width, height)) {
      if (left.some((m) => inside(m, pass.crop))) decoded += decodeCodes(work, pass, boxes);
    }
    marks = findAllMarks(work);
    left = [...marks.dark, ...marks.light];
  }

  // 3. Three marks at the corners of a square place a code jsQR could not read; a mark in no
  //    such square is left uncovered and counted.
  work.data.fill(0);
  let estimated = 0;
  let uncovered = 0;
  for (const group of [marks.dark, marks.light]) {
    const { codes, loose } = groupFinderMarks(group);
    for (const code of codes) {
      const pitch = (code.corner.pitch + code.b.pitch + code.c.pitch) / 3;
      const { corners, dimension } = cornersFromFinders(code.corner, code.b, code.c, pitch);
      boxes.push(qrCoverBox(corners, dimension, bounds));
    }
    estimated += codes.length;
    uncovered += loose.length;
  }
  return { boxes, decoded, estimated, uncovered };
}
