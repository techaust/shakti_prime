// Amounts of money in the business's own WhatsApp messages, masked before a brief's prompt: a
// reply a person typed may quote a price ("Your quote is ₹2,40,000"), and no price or cost ever
// reaches a model (design §7.3, the review of A2, finding 14). The customer's own words keep
// their numbers (a monthly bill, a bore depth), which the masking of personal numbers already
// reads.

/** What an amount becomes. */
export const AMOUNT_PLACEHOLDER = '[amount]';

const SCALE = 'lakhs?|lacs?|crores?|cr|k|thousand|hazaa?r';
const UNIT = 'rupees?|rupaye|rupaiye|rupay|rs\\.?|inr|\\/-';
const FIGURES = '\\d[\\d,]*(?:\\.\\d+)?';

/** A figure after a currency mark (₹, Rs, INR), with any scale word after it. */
const MARKED = new RegExp(
  `(?:₹|\\brs\\.?|\\binr)\\s*${FIGURES}(?:\\s*(?:${SCALE})\\b)?(?:\\s*\\/-)?`,
  'giu',
);
/** A figure with a scale or a unit after it ("2.4 lakh", "500 rupees", "45k"). */
const SCALED = new RegExp(
  `${FIGURES}\\s*(?:(?:${SCALE})\\b(?:\\s*(?:${UNIT}))?|(?:${UNIT})(?![\\p{L}]))`,
  'giu',
);
/** A number in words with a scale word after it ("dhai lakh", "do hazaar"). */
const WORDS = /(?<![\p{L}])\p{L}+\s+(?:lakhs?|lacs?|crores?|hazaa?r|thousand)(?![\p{L}])/giu;
/** Any other figure of four digits or more, or in Indian grouping (1,20,000). */
const LARGE = /(?<![\p{L}\d])(?:\d{1,3}(?:,\d{2,3})+|\d{4,})(?:\.\d+)?(?![\p{L}\d])/gu;

/** `text` with every amount of money in it, and every large figure, as `[amount]`. */
export function maskAmounts(text: string): string {
  return text
    .replace(MARKED, AMOUNT_PLACEHOLDER)
    .replace(SCALED, AMOUNT_PLACEHOLDER)
    .replace(WORDS, AMOUNT_PLACEHOLDER)
    .replace(LARGE, AMOUNT_PLACEHOLDER);
}
