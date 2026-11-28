import { verhoeffCheckDigit } from '@shakti/domain';
import { describe, expect, it } from 'vitest';
import { pdfOf } from './pdf';
import { DOCUMENTS_JOURNEY } from './users';

describe('the journeys’ PDF', () => {
  it('is a PDF with one page per text', async () => {
    const text = new TextDecoder().decode(await pdfOf(['First', 'Second']));
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text).toContain('/Count 2');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('carries a made-up Aadhaar number the masking step takes for one', () => {
    const digits = DOCUMENTS_JOURNEY.uploadedAadhaar.replaceAll(' ', '');
    expect(digits).toMatch(/^[2-9]\d{11}$/);
    expect(verhoeffCheckDigit(digits.slice(0, 11))).toBe(digits.slice(11));
  });
});
