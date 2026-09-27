import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import type { Box } from './plan-masks';
import {
  cornersFromFinders,
  findFinderMarks,
  groupFinderMarks,
  qrCoverBox,
  scanQrCodes,
  toGray,
  type Raster,
} from './qr-cover';
import { reviewCause } from './review';

// Small in-memory pictures only. The payloads are made-up words, never a number.

function blank(width: number, height: number, shade = 245): Raster {
  const data = new Uint8ClampedArray(width * height * 4).fill(shade);
  return { data, width, height };
}

function fillRect(image: Raster, x: number, y: number, w: number, h: number, shade: number) {
  for (let yy = Math.max(0, y); yy < Math.min(image.height, y + h); yy++) {
    for (let xx = Math.max(0, x); xx < Math.min(image.width, x + w); xx++) {
      const i = (yy * image.width + xx) * 4;
      image.data[i] = shade;
      image.data[i + 1] = shade;
      image.data[i + 2] = shade;
      image.data[i + 3] = 255;
    }
  }
}

/** Draws a QR code of `text` with its top-left module at (x, y); returns its outer extent. */
function drawQr(image: Raster, text: string, x: number, y: number, pitch: number): Box {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  for (let row = 0; row < modules.size; row++) {
    for (let col = 0; col < modules.size; col++) {
      if (modules.get(row, col))
        fillRect(image, x + col * pitch, y + row * pitch, pitch, pitch, 20);
    }
  }
  const side = modules.size * pitch;
  return { x0: x, y0: y, x1: x + side, y1: y + side };
}

/** One 7-module finder mark with its top-left corner at (x, y). */
function drawFinder(image: Raster, x: number, y: number, pitch: number) {
  fillRect(image, x, y, 7 * pitch, 7 * pitch, 20);
  fillRect(image, x + pitch, y + pitch, 5 * pitch, 5 * pitch, 245);
  fillRect(image, x + 2 * pitch, y + 2 * pitch, 3 * pitch, 3 * pitch, 20);
}

function contains(outer: Box, inner: Box, margin = 0): boolean {
  return (
    outer.x0 <= inner.x0 - margin &&
    outer.y0 <= inner.y0 - margin &&
    outer.x1 >= inner.x1 + margin &&
    outer.y1 >= inner.y1 + margin
  );
}

function cover(image: Raster, boxes: Box[]) {
  for (const b of boxes) fillRect(image, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, 0);
}

describe('qrCoverBox', () => {
  it('widens the code by its quiet zone and a tenth of its side', () => {
    // A 25-module code, 100 px a side: 4 px modules, margin 4 × 4 + 10 = 26 px.
    const corners = [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 200 },
      { x: 100, y: 200 },
    ];
    expect(qrCoverBox(corners, 25, { width: 1000, height: 1000 })).toEqual({
      x0: 74,
      y0: 74,
      x1: 226,
      y1: 226,
    });
  });

  it('covers a tilted code by the bounding box of its corners', () => {
    const corners = [
      { x: 150, y: 80 },
      { x: 220, y: 150 },
      { x: 150, y: 220 },
      { x: 80, y: 150 },
    ];
    const box = qrCoverBox(corners, 21, { width: 1000, height: 1000 });
    expect(contains(box, { x0: 80, y0: 80, x1: 220, y1: 220 }, 8)).toBe(true);
  });

  it('never covers less than the minimum margin and stays inside the photo', () => {
    const corners = [
      { x: 2, y: 2 },
      { x: 12, y: 2 },
      { x: 12, y: 12 },
      { x: 2, y: 12 },
    ];
    expect(qrCoverBox(corners, 21, { width: 18, height: 30 })).toEqual({
      x0: 0,
      y0: 0,
      x1: 18,
      y1: 20,
    });
  });

  it('clips a code at the far corner to the right and bottom edges', () => {
    // A 21-module code, 84 px a side: 4 px modules, margin 4 × 4 + 8.4 = 24.4 px.
    const corners = [
      { x: 200, y: 150 },
      { x: 284, y: 150 },
      { x: 284, y: 234 },
      { x: 200, y: 234 },
    ];
    expect(qrCoverBox(corners, 21, { width: 290, height: 240 })).toEqual({
      x0: 175,
      y0: 125,
      x1: 290,
      y1: 240,
    });
  });

  it('keeps every edge inside the photo even for corners outside it', () => {
    const corners = [
      { x: 400, y: -60 },
      { x: 480, y: -60 },
      { x: 480, y: 20 },
      { x: 400, y: 20 },
    ];
    const box = qrCoverBox(corners, 21, { width: 300, height: 200 });
    for (const v of [box.x0, box.x1]) expect(v).toBeGreaterThanOrEqual(0);
    for (const v of [box.x0, box.x1]) expect(v).toBeLessThanOrEqual(300);
    for (const v of [box.y0, box.y1]) expect(v).toBeGreaterThanOrEqual(0);
    for (const v of [box.y0, box.y1]) expect(v).toBeLessThanOrEqual(200);
    expect(box.x0).toBeLessThanOrEqual(box.x1);
    expect(box.y0).toBeLessThanOrEqual(box.y1);
  });
});

describe('cornersFromFinders', () => {
  it('puts each corner 3.5 modules beyond its finder centre and completes the square', () => {
    // A 21-module code at (40, 40) with 10 px modules: finder centres 35 px in from each corner.
    const { corners, dimension } = cornersFromFinders(
      { x: 75, y: 75 },
      { x: 215, y: 75 },
      { x: 75, y: 215 },
      10,
    );
    expect(dimension).toBeCloseTo(21);
    const rounded = corners.map((c) => ({ x: Math.round(c.x), y: Math.round(c.y) }));
    expect(rounded).toEqual([
      { x: 40, y: 40 },
      { x: 250, y: 40 },
      { x: 250, y: 250 },
      { x: 40, y: 250 },
    ]);
  });
});

describe('scanQrCodes', () => {
  it('finds nothing on a plain photo', () => {
    const image = blank(240, 160);
    fillRect(image, 20, 60, 180, 6, 30);
    expect(scanQrCodes(image)).toEqual({ boxes: [], decoded: 0, estimated: 0, uncovered: 0 });
  });

  it('covers a code with its quiet zone, so nothing can be read afterwards', () => {
    const image = blank(320, 260);
    const code = drawQr(image, 'made-up card holder record', 150, 60, 4);
    const scan = scanQrCodes(image);
    expect(scan.decoded).toBe(1);
    expect(scan.uncovered).toBe(0);
    expect(scan.boxes.some((b) => contains(b, code, 4 * 4))).toBe(true);
    cover(image, scan.boxes);
    expect(
      jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' }),
    ).toBeNull();
  });

  it('covers every code on the photo, a small one in a corner as well', () => {
    const image = blank(420, 300);
    const large = drawQr(image, 'made-up letter record', 30, 40, 5);
    const small = drawQr(image, 'made-up small mark', 330, 220, 2);
    const scan = scanQrCodes(image);
    expect(scan.boxes.some((b) => contains(b, large, 8))).toBe(true);
    expect(scan.boxes.some((b) => contains(b, small, 8))).toBe(true);
    cover(image, scan.boxes);
    expect(
      jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' }),
    ).toBeNull();
  });

  it('covers a code it cannot decode from its three finder marks', () => {
    const image = blank(300, 300);
    // Three finder marks of a 25-module code at (60, 60), 6 px modules, and no readable data.
    drawFinder(image, 60, 60, 6);
    drawFinder(image, 60 + 18 * 6, 60, 6);
    drawFinder(image, 60, 60 + 18 * 6, 6);
    const scan = scanQrCodes(image);
    expect(scan.decoded).toBe(0);
    expect(scan.estimated).toBe(1);
    expect(scan.uncovered).toBe(0);
    expect(scan.boxes.some((b) => contains(b, { x0: 60, y0: 60, x1: 210, y1: 210 }, 12))).toBe(
      true,
    );
  });

  it('counts a finder mark that belongs to no code as uncovered', () => {
    const image = blank(200, 200);
    drawFinder(image, 70, 70, 6);
    const scan = scanQrCodes(image);
    expect(scan.boxes).toEqual([]);
    expect(scan.uncovered).toBe(1);
  });

  it('covers a code that runs to the edge of the photo, clipped to the edge', () => {
    const image = blank(260, 200);
    // Quiet zone of one module only on the right and bottom: the box must stop at the edge.
    const size = QRCode.create('made-up edge record', { errorCorrectionLevel: 'M' }).modules.size;
    const code = drawQr(image, 'made-up edge record', 260 - 4 - size * 4, 200 - 4 - size * 4, 4);
    const scan = scanQrCodes(image);
    expect(scan.decoded).toBe(1);
    const box = scan.boxes.find((b) => contains(b, code));
    expect(box).toBeDefined();
    expect(box?.x1).toBe(260);
    expect(box?.y1).toBe(200);
    cover(image, scan.boxes);
    expect(
      jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' }),
    ).toBeNull();
  });

  it('covers a light code printed on a dark ground', () => {
    const image = blank(300, 260, 20);
    const { modules } = QRCode.create('made-up light record', { errorCorrectionLevel: 'M' });
    for (let row = 0; row < modules.size; row++) {
      for (let col = 0; col < modules.size; col++) {
        if (modules.get(row, col)) fillRect(image, 90 + col * 4, 60 + row * 4, 4, 4, 245);
      }
    }
    const scan = scanQrCodes(image);
    expect(scan.decoded).toBe(1);
    cover(image, scan.boxes);
    expect(
      jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' }),
    ).toBeNull();
  });

  it('covers a small code on a large photo', () => {
    const image = blank(1400, 360);
    for (let i = 0; i < 12; i++) fillRect(image, 40 + i * 90, 40, 70, 12, 30);
    const code = drawQr(image, 'made-up small record', 1250, 250, 2);
    const scan = scanQrCodes(image);
    expect(scan.boxes.some((b) => contains(b, code, 8))).toBe(true);
    cover(image, scan.boxes);
    expect(
      jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' }),
    ).toBeNull();
  });

  it('counts light finder marks on a dark ground that belong to no code', () => {
    const image = blank(320, 260, 20);
    for (const x of [60, 60 + 18 * 6]) {
      fillRect(image, x, 60, 42, 42, 245);
      fillRect(image, x + 6, 66, 30, 30, 20);
      fillRect(image, x + 12, 72, 18, 18, 245);
    }
    const scan = scanQrCodes(image);
    expect(scan.boxes).toEqual([]);
    expect(scan.uncovered).toBe(2);
  });

  it('leaves the photo it is given unchanged', () => {
    const image = blank(200, 200);
    drawQr(image, 'made-up record', 40, 40, 4);
    const before = Buffer.from(image.data).toString('base64');
    scanQrCodes(image);
    expect(Buffer.from(image.data).toString('base64')).toBe(before);
  });
});

describe('holding an Aadhaar photo whose QR code cannot be covered', () => {
  // A torn code: two finder marks of a 25-module code and no third, so it can be neither
  // decoded nor placed from its marks.
  function tornCode(): Raster {
    const image = blank(320, 260);
    drawFinder(image, 60, 60, 6);
    drawFinder(image, 60 + 18 * 6, 60, 6);
    return image;
  }
  const found = { aadhaarFound: true, bankFound: false } as const;

  it('holds it for review when the slot says Aadhaar', () => {
    const scan = scanQrCodes(tornCode());
    expect(scan.uncovered).toBe(2);
    expect(
      reviewCause({ expect: ['aadhaar'], readText: '', ...found, qrUncovered: scan.uncovered }),
    ).toBe('qr_not_covered');
  });

  it('holds it for review when the photo reads as an Aadhaar card', () => {
    const scan = scanQrCodes(tornCode());
    expect(
      reviewCause({
        expect: [],
        readText: 'Government of India',
        ...found,
        qrUncovered: scan.uncovered,
      }),
    ).toBe('qr_not_covered');
  });

  it('keeps an Aadhaar photo whose code was located and covered', () => {
    const image = blank(320, 260);
    drawQr(image, 'made-up card holder record', 150, 60, 4);
    const scan = scanQrCodes(image);
    expect(scan.boxes).toHaveLength(1);
    expect(
      reviewCause({ expect: ['aadhaar'], readText: '', ...found, qrUncovered: scan.uncovered }),
    ).toBeUndefined();
  });
});

describe('groupFinderMarks', () => {
  it('pairs three marks at the corners of a square and leaves a stray mark loose', () => {
    const image = blank(400, 400);
    drawFinder(image, 40, 40, 5);
    drawFinder(image, 40 + 20 * 5, 40, 5);
    drawFinder(image, 40, 40 + 20 * 5, 5);
    drawFinder(image, 320, 320, 5);
    const marks = findFinderMarks(toGray(image));
    expect(marks).toHaveLength(4);
    const { codes, loose } = groupFinderMarks(marks);
    expect(codes).toHaveLength(1);
    expect(loose).toHaveLength(1);
    // The stray mark's centre, 3.5 modules in from its corner, within a pixel.
    const [stray] = loose;
    expect(Math.abs((stray?.x ?? 0) - (320 + 17.5))).toBeLessThanOrEqual(1);
    expect(Math.abs((stray?.y ?? 0) - (320 + 17.5))).toBeLessThanOrEqual(1);
  });
});
