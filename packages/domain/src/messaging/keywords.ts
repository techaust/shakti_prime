import { WORKSHOP_DEFAULTS } from '../workshop-defaults';

/** What a customer's message asks for, when it is one of the keywords and nothing else. */
export type WhatsAppKeyword = 'stop' | 'human' | 'status';

/** A message read for a keyword: lower case, punctuation and emoji gone, spaces collapsed. */
function normalise(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The keyword a customer's whole message is (docs/03-roadmap-appendix/phase2.md §6.1), from
 * `WORKSHOP_DEFAULTS.whatsapp.keywords` in English and Roman Hindi, whatever its case or
 * punctuation: "Stop!", "BAND KARO" and "human." all count; a longer sentence that only contains a
 * keyword does not, so "don't stop the visit" never opts a customer out. STOP wins over the others.
 */
export function matchKeyword(
  text: string | null,
  keywords: Readonly<Record<WhatsAppKeyword, readonly string[]>> = WORKSHOP_DEFAULTS.whatsapp
    .keywords,
): WhatsAppKeyword | null {
  if (text === null) return null;
  const read = normalise(text);
  if (read === '') return null;
  for (const keyword of ['stop', 'human', 'status'] as const) {
    if (keywords[keyword].some((k) => normalise(k) === read)) return keyword;
  }
  return null;
}
