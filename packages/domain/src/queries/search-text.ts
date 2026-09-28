/**
 * The typed text as a `LIKE` pattern that finds it anywhere: the wildcard characters a person may
 * type (`%`, `_`) and the escape character itself match only themselves.
 */
export function containsPattern(text: string): string {
  return `%${text.replaceAll(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * The digits of a text that reads as part of a phone number (`98765`, `+91 98765 43210`,
 * `43-210`), or undefined for any other text. Spaces, dashes, brackets and a leading plus are
 * how people write numbers, so they are dropped; anything else means the text is a name.
 */
export function phoneDigits(text: string): string | undefined {
  const digits = text.replaceAll(/[\s\-()]/g, '').replace(/^\+/, '');
  return /^\d{2,15}$/.test(digits) ? digits : undefined;
}
