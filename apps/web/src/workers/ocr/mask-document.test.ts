import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

// The masking step shares one OCR worker per process. This stands in for the worker and records
// the order of its calls; the real engine is exercised by the PDF test that needs the model.
const calls = vi.hoisted((): string[] => []);
let parameterNow = '';

vi.mock('tesseract.js', () => ({
  PSM: { AUTO: '3', SPARSE_TEXT: '11', SINGLE_BLOCK: '6' },
  createWorker: () =>
    Promise.resolve({
      setParameters: async (parameters: Record<string, string>) => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        if (parameters.tessedit_pageseg_mode !== undefined) {
          parameterNow = parameters.tessedit_pageseg_mode;
          calls.push(`set ${parameterNow}`);
        }
      },
      recognize: async () => {
        // The mode this read is made in is the one its own mask set last.
        const mode = parameterNow;
        await new Promise((resolve) => setTimeout(resolve, 5));
        calls.push(`read ${mode} ${mode === parameterNow ? 'same' : 'changed'}`);
        return { data: { blocks: [] } };
      },
      terminate: () => Promise.resolve(),
    }),
}));

const { createDocumentMasker } = await import('./mask-document');

async function photo(): Promise<Buffer> {
  return sharp({ create: { width: 800, height: 600, channels: 3, background: '#ffffff' } })
    .png()
    .toBuffer();
}

describe('the masking step', () => {
  it('masks one photo at a time, so two checks never mix their reading modes', async () => {
    const masker = await createDocumentMasker({ langPath: 'not used by the stand-in' });
    calls.length = 0;
    const [a, b] = await Promise.all([masker.mask(await photo()), masker.mask(await photo())]);
    expect(a.status).not.toBe('needs_review');
    expect(b.status).not.toBe('needs_review');
    // Every mode set is read at once, and no read finds another mask's mode in its place.
    const reads = calls.filter((c) => c.startsWith('read'));
    expect(reads.length).toBeGreaterThanOrEqual(8);
    expect(reads.every((c) => c.endsWith('same'))).toBe(true);
    for (let i = 0; i < calls.length; i += 2) {
      expect(calls[i]?.startsWith('set')).toBe(true);
      expect(calls[i + 1]?.startsWith('read')).toBe(true);
    }
    await masker.close();
  });

  it('carries on after a mask that failed', async () => {
    const masker = await createDocumentMasker({ langPath: 'not used by the stand-in' });
    await expect(masker.mask(Buffer.from('not a picture'))).rejects.toThrow();
    expect((await masker.mask(await photo())).status).not.toBe('needs_review');
    await masker.close();
  });
});
