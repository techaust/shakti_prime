import { describe, expect, it } from 'vitest';
import { isHandledByPlatform } from './handled-by-platform';

describe('isHandledByPlatform (docs/03-roadmap-appendix/phase2.md §7.1)', () => {
  it('is true only for a message the platform marked as its own to answer', () => {
    expect(isHandledByPlatform({ platform: true })).toBe(true);
    expect(isHandledByPlatform({ platform: false })).toBe(false);
    // An event written before the mark existed is the Concierge's to answer.
    expect(isHandledByPlatform({})).toBe(false);
  });
});
