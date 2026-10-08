import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { pdfOf } from '../../../tests/support/pdf-fixtures';
import {
  countPdfPages,
  jpegsToPdf,
  MAX_PAGE_EDGE_PX,
  renderMaskedPages,
  renderPdfPages,
  renderScale,
} from './pdf-pages';

// Drawing a vault PDF's pages with PDFium (docs/03-roadmap-appendix/phase1.md §8.4). Every number here is made up.

describe('drawing a PDF as pictures', () => {
  it('counts the pages and draws each one, in order, as a PNG or a JPEG', async () => {
    const bytes = await pdfOf(['First page', 'Second page']);
    expect(await countPdfPages(bytes)).toBe(2);
    let drawn = 0;
    for await (const page of renderPdfPages(bytes, 'png')) {
      expect(Buffer.from(page.image).subarray(1, 4).toString()).toBe('PNG');
      expect([page.widthPt, page.heightPt]).toEqual([612, 792]);
      drawn += 1;
    }
    expect(drawn).toBe(2);
    const jpegs = await renderMaskedPages(bytes);
    expect(jpegs).toHaveLength(2);
    expect(Array.from((jpegs[0] ?? new Uint8Array()).subarray(0, 2))).toEqual([0xff, 0xd8]);
  });

  it('refuses what is not a PDF', async () => {
    await expect(countPdfPages(new TextEncoder().encode('not a pdf at all'))).rejects.toThrow();
  });
});

describe('the size a page is drawn at', () => {
  it('draws one page only when asked, by its position', async () => {
    const bytes = await pdfOf(['First page', 'Second page', 'Third page']);
    const drawn: number[] = [];
    for await (const page of renderPdfPages(bytes, 'png', 1)) drawn.push(page.image.length);
    expect(drawn).toHaveLength(1);
    const beyond: number[] = [];
    for await (const page of renderPdfPages(bytes, 'png', 3)) beyond.push(page.image.length);
    expect(beyond).toEqual([]);
  });

  it('keeps a letter page at 150 pixels an inch and shrinks a poster by its area', () => {
    expect(renderScale(612, 792)).toBeCloseTo(150 / 72, 5);
    const poster = renderScale(3000, 3000);
    expect(poster).toBeLessThan(150 / 72);
    expect(3000 * poster * 3000 * poster).toBeLessThanOrEqual(16_000_000 + 1);
  });

  it('keeps the longest side of a banner-shaped page under what the model accepts', async () => {
    // A 200 by 5 inch page would be about 30,000 pixels long at 150 pixels an inch.
    const [widthPt, heightPt] = [14_400, 360];
    expect(renderScale(widthPt, heightPt)).toBeLessThan(150 / 72);
    const picture = await sharp({
      create: { width: 200, height: 20, channels: 3, background: '#ffffff' },
    })
      .jpeg()
      .toBuffer();
    const banner = await jpegsToPdf([{ jpeg: new Uint8Array(picture), widthPt, heightPt }]);
    let sides: [number, number] | undefined;
    for await (const page of renderPdfPages(banner, 'png')) {
      const meta = await sharp(Buffer.from(page.image)).metadata();
      sides = [meta.width, meta.height];
    }
    expect(sides).toBeDefined();
    expect(Math.max(...(sides ?? [0, 0]))).toBeLessThanOrEqual(MAX_PAGE_EDGE_PX);
    expect(Math.max(...(sides ?? [0, 0]))).toBeGreaterThan(MAX_PAGE_EDGE_PX - 10);
    // The model's copy of a masked page is drawn the same way.
    const [copy] = await renderMaskedPages(banner);
    const copyMeta = await sharp(Buffer.from(copy ?? [])).metadata();
    expect(Math.max(copyMeta.width, copyMeta.height)).toBeLessThanOrEqual(MAX_PAGE_EDGE_PX);
  });
});
