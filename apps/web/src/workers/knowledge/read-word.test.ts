import { describe, expect, it } from 'vitest';
import { wordDocument } from '../../../e2e/support/docx';
import { readWordText } from './read-word';

describe('readWordText', () => {
  it('reads each paragraph of a Word document', async () => {
    const text = await readWordText(
      wordDocument(['Solar pump care', 'Clean the panels with plain water & a soft cloth.']),
    );
    expect(text).toContain('Solar pump care');
    expect(text).toContain('Clean the panels with plain water & a soft cloth.');
  });

  it('refuses a file that is not a Word document', async () => {
    await expect(readWordText(new TextEncoder().encode('plain text'))).rejects.toThrow();
  });
});
