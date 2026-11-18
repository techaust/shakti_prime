import { describe, expect, it } from 'vitest';
import { milestoneMisfit, purposeMisfit } from './template-shape';

// Which registered templates the platform can send for a milestone or a purpose
// (docs/03-roadmap-appendix/phase2.md §7.1): Meta refuses a message whose header or buttons do not
// match the template as submitted.

const replies = [{ kind: 'quick_reply' as const }, { kind: 'quick_reply' as const }];
const quoteTemplate = {
  category: 'utility',
  params: ['Quote', 'Total', 'Valid until'],
  buttons: replies,
  header: 'document',
  purpose: null,
};

describe('the shape of a milestone’s template', () => {
  it('fits a quote with its document and its two reply buttons, and nothing else', () => {
    expect(milestoneMisfit('quote_sent', quoteTemplate)).toBeNull();
    expect(milestoneMisfit('quote_sent', { ...quoteTemplate, header: 'none' })).toBe('shape');
    expect(milestoneMisfit('quote_sent', { ...quoteTemplate, buttons: [] })).toBe('shape');
    expect(
      milestoneMisfit('quote_sent', {
        ...quoteTemplate,
        buttons: [{ kind: 'quick_reply' }, { kind: 'url' }],
      }),
    ).toBe('shape');
    expect(milestoneMisfit('quote_sent', { ...quoteTemplate, params: ['Quote'] })).toBe('values');
    expect(milestoneMisfit('quote_sent', { ...quoteTemplate, category: 'authentication' })).toBe(
      'unfit',
    );
    expect(milestoneMisfit('quote_sent', { ...quoteTemplate, purpose: 'welcome' })).toBe('unfit');
  });

  it('fits an order’s confirmation with its words alone', () => {
    const order = { ...quoteTemplate, params: ['Order', 'Total'], buttons: [], header: 'none' };
    expect(milestoneMisfit('order_confirmed', order)).toBeNull();
    expect(milestoneMisfit('order_confirmed', { ...order, buttons: replies })).toBe('shape');
    expect(milestoneMisfit('order_confirmed', { ...order, header: 'document' })).toBe('shape');
  });
});

describe('the shape of a purpose’s template', () => {
  const code = {
    category: 'authentication',
    params: ['Code'],
    buttons: [{ kind: 'url' as const }],
    header: 'none',
  };

  it('takes the one-time code only as an authentication template with one copy-code button', () => {
    expect(purposeMisfit('acceptance_code', code)).toBeNull();
    expect(purposeMisfit('acceptance_code', { ...code, category: 'utility' })).toBe('shape');
    expect(purposeMisfit('acceptance_code', { ...code, buttons: [] })).toBe('shape');
    expect(purposeMisfit('acceptance_code', { ...code, header: 'document' })).toBe('shape');
    expect(purposeMisfit('acceptance_code', { ...code, params: [] })).toBe('values');
  });

  it('leaves the other purposes’ kind, header and buttons as registered, with their values', () => {
    const plain = { category: 'utility', params: [], buttons: replies, header: 'none' };
    expect(purposeMisfit('welcome', plain)).toBeNull();
    expect(purposeMisfit('quote_expired', { ...plain, params: ['Quote'] })).toBeNull();
    expect(purposeMisfit('quote_expired', plain)).toBe('values');
  });
});
