/**
 * Where the screen-pop may open a page by itself (docs/03-roadmap-appendix/phase2.md §7.4): only
 * on a page that is no form (home, the customer and lead lists, a customer's Account 360), and only
 * while the person has typed nothing into a field there. Anywhere else the card shows the call
 * with its Open buttons, so a call never moves away from, or fills into, what the person is
 * entering (the app has no unsaved-changes guard to ask first).
 */

const QUIET_PAGES: readonly RegExp[] = [
  /^\/home$/,
  /^\/customers$/,
  // A customer's Account 360, not a form below it.
  /^\/customers\/[^/]+$/,
  /^\/leads$/,
  /^\/leads\/board$/,
];

/** Whether the call may open its page on arrival, from this page in this state. */
export function opensOnArrival(pathname: string, typedHere: boolean): boolean {
  if (typedHere) return false;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return QUIET_PAGES.some((page) => page.test(path));
}

const FIELDS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Whether an `input` event came from something the person types or chooses in (a box, a list, a
 * tick box, an editable area) outside the screen-pop's own card.
 */
export function isTyping(target: EventTarget | null, card: Node | null): boolean {
  if (target === null) return false;
  if (card?.contains(target as Node) === true) return false;
  const field = target as { tagName?: unknown; isContentEditable?: unknown };
  return (
    (typeof field.tagName === 'string' && FIELDS.has(field.tagName)) ||
    field.isContentEditable === true
  );
}
