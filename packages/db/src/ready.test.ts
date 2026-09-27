import { describe, expect, it } from 'vitest';
import { probeReady } from './ready';

describe('probeReady (AUDIT L11)', () => {
  it('answers ok, and down for a failure, a failure before the start, or a slow probe', async () => {
    await expect(probeReady(() => Promise.resolve())).resolves.toBe('ok');
    await expect(probeReady(() => Promise.reject(new Error('refused')))).resolves.toBe('down');
    await expect(
      probeReady(() => {
        throw new Error('DATABASE_URL is not set');
      }),
    ).resolves.toBe('down');
    await expect(probeReady(() => new Promise(() => undefined), 10)).resolves.toBe('down');
  });
});
