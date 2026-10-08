import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentMasker } from './mask-document';

// Which masking step a page's timeout closes: the one the page used, never a newer one.

const closed: DocumentMasker[] = [];
vi.mock('./mask-document', () => ({
  createDocumentMasker: () => {
    const masker: DocumentMasker = {
      mask: () => Promise.reject(new Error('not used')),
      close: () => {
        closed.push(masker);
        return Promise.resolve();
      },
    };
    return Promise.resolve(masker);
  },
}));

afterEach(() => {
  closed.length = 0;
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('discarding the vault masking step', () => {
  it('closes the one the late page used and opens a new one for the next check', async () => {
    vi.stubEnv('OCR_LANG_PATH', 'C:/models');
    const { vaultMasker, discardVaultMasker } = await import('./vault-masker');
    const old = await vaultMasker();
    await discardVaultMasker(old);
    expect(closed).toEqual([old]);
    const next = await vaultMasker();
    expect(next).not.toBe(old);
  });

  it('never closes a newer masking step because an older page timed out', async () => {
    vi.stubEnv('OCR_LANG_PATH', 'C:/models');
    const { vaultMasker, discardVaultMasker } = await import('./vault-masker');
    const old = await vaultMasker();
    await discardVaultMasker(old);
    const current = await vaultMasker();
    // The old page's own timeout arrives late.
    await discardVaultMasker(old);
    expect(closed).not.toContain(current);
    expect(await vaultMasker()).toBe(current);
  });
});
