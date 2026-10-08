import sharp from 'sharp';
import type * as Tesseract from 'tesseract.js';
import { describe, expect, it, vi } from 'vitest';
import { createDocumentMasker } from './mask-document';

// The masking step takes one mask at a time. The OCR engine is replaced by one the test controls
// (the real one never settles a read it was closed under).

const reads: { release: () => void }[] = [];
vi.mock('tesseract.js', async (importOriginal) => {
  const real = await importOriginal<typeof Tesseract>();
  return {
    ...real,
    createWorker: () =>
      Promise.resolve({
        setParameters: () => Promise.resolve(),
        recognize: () =>
          new Promise((resolve) => {
            reads.push({
              release: () => {
                resolve({ data: { blocks: [] } });
              },
            });
          }),
        terminate: () => Promise.resolve(),
      }),
  };
});

const photo = () =>
  sharp({ create: { width: 200, height: 100, channels: 3, background: '#ffffff' } })
    .png()
    .toBuffer();
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('the masking queue', () => {
  it('starts the second mask only when the first is finished, and says when each turn begins', async () => {
    reads.length = 0;
    const masker = await createDocumentMasker({ langPath: 'unused' });
    const turns: string[] = [];
    const first = masker.mask(await photo(), { onTurn: () => turns.push('first') });
    const second = masker.mask(await photo(), { onTurn: () => turns.push('second') });
    await settle();
    expect(turns).toEqual(['first']);
    // Release the first mask's reads (it reads the photo up to four ways) until it is through.
    const state = { finished: false };
    void first.then(() => {
      state.finished = true;
    });
    for (let i = 0; i < 12 && !state.finished; i += 1) {
      reads.shift()?.release();
      await settle();
    }
    await first;
    expect(turns).toEqual(['first', 'second']);
    for (let i = 0; i < 12; i += 1) {
      reads.shift()?.release();
      await settle();
    }
    await second;
    await masker.close();
  });

  it('answers every mask running or waiting when it is closed, so none hangs', async () => {
    reads.length = 0;
    const masker = await createDocumentMasker({ langPath: 'unused' });
    const running = masker.mask(await photo());
    const waiting = masker.mask(await photo());
    await settle();
    await masker.close();
    await expect(running).rejects.toMatchObject({ code: 'integration_unavailable' });
    await expect(waiting).rejects.toMatchObject({ code: 'integration_unavailable' });
    await expect(masker.mask(await photo())).rejects.toMatchObject({
      code: 'integration_unavailable',
    });
  });

  it('never runs a mask that gave up waiting for its turn, and wipes its photo', async () => {
    reads.length = 0;
    const masker = await createDocumentMasker({ langPath: 'unused' });
    const turns: string[] = [];
    const running = masker.mask(await photo());
    running.catch(() => undefined);
    const controller = new AbortController();
    const bytes = await photo();
    const waiting = masker.mask(bytes, {
      onTurn: () => turns.push('waiting'),
      signal: controller.signal,
    });
    waiting.catch(() => undefined);
    await settle();
    controller.abort();
    // The first mask ends (its reads are released); the aborted one is then skipped.
    for (let i = 0; i < 12; i += 1) {
      reads.shift()?.release();
      await settle();
    }
    await expect(waiting).rejects.toMatchObject({ code: 'integration_unavailable' });
    expect(turns).toEqual([]);
    expect(bytes.every((b) => b === 0)).toBe(true);
    await masker.close();
  });
});
