import { LABEL_SIZES, newId, type LabelSize } from '@shakti/contracts';
import { parseLabelPayload, WORKSHOP_DEFAULTS } from '@shakti/domain';
import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import { labelPrintsOf } from './documents';
import { spikeBinLabels, spikeLabels, spikePackageLabels } from './fixtures/spike-documents';
import { renderLabelsHtml, type LabelPrint } from './label-template';

/**
 * INV-07 (docs/03-roadmap-appendix/phase3.md §7.4): every label's QR code, as the template prints
 * it, decodes back to its payload with jsQR, and the payload back to its record. The code is read
 * from the label's own SVG: its path is drawn into pixels here, module by module, so the test
 * needs no browser; the journeys' snapshots and the batch measure print it with Chromium.
 */

/** Each QR code's SVG in a label page, in order. */
function svgsOf(page: string): string[] {
  return page.match(/<svg[\s\S]*?<\/svg>/g) ?? [];
}

/**
 * The dark modules of a code `qrcode` drew as SVG: one path of horizontal runs, `M x y` and
 * `m dx dy` moving the pen, `h n` a run of n modules on the row at y - 0.5.
 */
function modulesOf(svg: string): { size: number; dark: Set<string> } {
  const size = Number(/viewBox="0 0 (\d+) \1"/.exec(svg)?.[1]);
  const d = /<path stroke="[^"]+" d="([^"]+)"/.exec(svg)?.[1];
  if (!Number.isInteger(size) || d === undefined) throw new Error('not a QR code drawn by qrcode');
  const dark = new Set<string>();
  let x = 0;
  let y = 0;
  for (const [, op, args] of d.matchAll(/([MmHh])([^MmHh]*)/g)) {
    const n = (args ?? '')
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (op === 'M') [x, y] = [n[0] ?? 0, n[1] ?? 0];
    else if (op === 'm') [x, y] = [x + (n[0] ?? 0), y + (n[1] ?? 0)];
    else {
      const run = op === 'h' ? (n[0] ?? 0) : (n[0] ?? 0) - x;
      for (let i = 0; i < run; i += 1) dark.add(`${String(x + i)},${String(Math.floor(y))}`);
      x += run;
    }
  }
  return { size, dark };
}

/** The code as RGBA pixels, 6 to a module, with the four-module quiet zone a scanner needs. */
function decode(svg: string): string | undefined {
  const { size, dark } = modulesOf(svg);
  const scale = 6;
  const quiet = 4;
  const width = (size + 2 * quiet) * scale;
  const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
  for (const cell of dark) {
    const [mx, my] = cell.split(',').map(Number) as [number, number];
    for (let py = 0; py < scale; py += 1) {
      for (let px = 0; px < scale; px += 1) {
        const at = (((my + quiet) * scale + py) * width + (mx + quiet) * scale + px) * 4;
        pixels[at] = 17;
        pixels[at + 1] = 17;
        pixels[at + 2] = 17;
      }
    }
  }
  return jsQR(pixels, width, width)?.data;
}

const KINDS: [string, LabelPrint[]][] = [
  ['serial', spikeLabels(3)],
  ['bin', spikeBinLabels(3)],
  ['package', spikePackageLabels(3)],
];

describe('every label’s QR code decodes back to its payload (INV-07)', () => {
  for (const [kind, labels] of KINDS) {
    for (const size of LABEL_SIZES) {
      it(`a ${kind} label at ${size} mm`, async () => {
        const codes = svgsOf(await renderLabelsHtml(labels, size));
        expect(codes).toHaveLength(labels.length);
        for (const [i, label] of labels.entries()) {
          const read = decode(codes[i] ?? '');
          expect(read).toBe(label.qrPayload);
          expect(parseLabelPayload(read ?? '')).toMatchObject({ kind: 'label', labelKind: kind });
        }
      });
    }
  }

  it('reads the record’s id back from a sheet the worker loaded', async () => {
    const ids = [newId(), newId()];
    const labels = labelPrintsOf({
      labelKind: 'bin',
      labels: ids.map((id, i) => ({
        id,
        binCode: `R01-S0${String(i + 1)}`,
        hubCode: 'JPR',
        hubName: 'Jaipur godown',
      })),
    });
    const codes = svgsOf(await renderLabelsHtml(labels, '50x25'));
    expect(codes.map((svg) => parseLabelPayload(decode(svg) ?? ''))).toEqual(
      ids.map((id) => ({ kind: 'label', labelKind: 'bin', id })),
    );
  });
});

describe('the label kinds', () => {
  it('print on the stock the workshop default names: 50 × 25 mm, packages 100 × 50 mm', () => {
    const sizes: Record<string, LabelSize> = WORKSHOP_DEFAULTS.labels.sizeByKind;
    expect(sizes).toEqual({ serial: '50x25', bin: '50x25', package: '100x50' });
  });

  it('a serial label names the company, item, SKU and serial number', async () => {
    const page = await renderLabelsHtml(spikeLabels(1), '50x25');
    for (const text of [
      'Agro Solar Hub',
      'Pump controller with remote monitoring, 7.5 HP',
      'ASH-PC-075',
      'ASH26C000001',
      en.print.label.item,
      en.print.label.serial,
    ]) {
      expect(page).toContain(text);
    }
  });

  it('a bin label names the bin and its hub', async () => {
    const page = await renderLabelsHtml(spikeBinLabels(1), '50x25');
    expect(page).toContain('<div class="label bin">');
    for (const text of ['Jaipur godown', 'JPR', 'R04-S01', en.print.label.hub]) {
      expect(page).toContain(text);
    }
  });

  it('a package label names the dispatch, the package of how many, the customer and place', async () => {
    const page = await renderLabelsHtml(spikePackageLabels(4), '100x50');
    for (const text of [
      'ASH/DC/2026-27/000127',
      '2 of 4',
      'Ramesh Kumar Meena',
      'Village Rampura, Chomu',
      'Jaipur godown',
      en.print.label.dispatch,
      en.print.label.place,
    ]) {
      expect(page).toContain(text);
    }
  });

  it('escapes what a person typed, so a name cannot become markup', async () => {
    const [label] = spikeLabels(1);
    if (label === undefined) throw new Error('a label');
    const page = await renderLabelsHtml([{ ...label, itemName: '<img src=x>' }], '50x25');
    expect(page).not.toContain('<img src=x>');
    expect(page).toContain('&lt;img src=x&gt;');
  });
});
