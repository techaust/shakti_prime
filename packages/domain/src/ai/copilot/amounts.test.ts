import { describe, expect, it } from 'vitest';
import { maskAmounts } from './amounts';
import { chatLines, type ChatRow } from './read-facts';

// No price reaches a brief's prompt: the business's own WhatsApp texts have their amounts masked
// before the prompt is built (the review of A2, finding 14).

const NOW = new Date('2026-11-18T06:00:00.000Z');

describe('maskAmounts', () => {
  it('masks an amount however it is written', () => {
    for (const [text, out] of [
      ['Your quote is ₹2,40,000 for the 5 HP set.', 'Your quote is [amount] for the 5 HP set.'],
      ['Price Rs. 1,85,500/- with fitting.', 'Price [amount] with fitting.'],
      ['INR 95000 only', '[amount] only'],
      ['Total 2.4 lakh rupees', 'Total [amount]'],
      ['It comes to dhai lakh.', 'It comes to [amount].'],
      ['Advance 45k, rest on delivery.', 'Advance [amount], rest on delivery.'],
      ['Pay 500 rupees as booking.', 'Pay [amount] as booking.'],
      ['Final 240000.', 'Final [amount].'],
    ] as const) {
      expect(maskAmounts(text)).toBe(out);
    }
  });

  it('keeps small figures and ordinary words', () => {
    const plain = 'Our engineer visits in 2 days for the 5 HP pump, okay? Call at 11.';
    expect(maskAmounts(plain)).toBe(plain);
  });
});

describe('chatLines', () => {
  const row = (direction: string, body: string): ChatRow => ({
    direction,
    kind: 'text',
    body_masked: body,
    template_name: null,
    created_at: NOW,
  });

  it('masks the amounts of the business’s texts, and keeps the customer’s words', () => {
    const lines = chatLines(
      [
        row('outbound', 'Your quote is ₹2,40,000. It is valid for 15 days.'),
        row('inbound', 'Mera bill 3200 aata hai.'),
      ],
      [],
      NOW,
    );
    expect(lines).toEqual([
      { direction: 'outbound', daysAgo: 0, text: 'Your quote is [amount]. It is valid for 15 days.' },
      { direction: 'inbound', daysAgo: 0, text: 'Mera bill 3200 aata hai.' },
    ]);
  });
});
