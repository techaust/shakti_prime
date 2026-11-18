/** What a key does on the assistant's draft in a chat: send it, edit it or discard it. */
export type DraftKeyAction = 'send' | 'edit' | 'discard';

/**
 * The draft line's keys (docs/03-roadmap-appendix/phase2.md §7.2): S sends the draft, E opens it
 * to edit, D discards it, in either case; never with a modifier, so the browser's own shortcuts
 * keep working.
 */
export function draftKeyAction(event: {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): DraftKeyAction | undefined {
  if (event.altKey || event.ctrlKey || event.metaKey) return undefined;
  switch (event.key.toLowerCase()) {
    case 's':
      return 'send';
    case 'e':
      return 'edit';
    case 'd':
      return 'discard';
    default:
      return undefined;
  }
}

/**
 * The draft line's key in the chat: read afresh for the chat's newest message and on each time the
 * chat is read again (`reads`), so a draft written after the chat opened shows at the chat's next
 * refresh (a reply sent, a hand-over, a decision), with no polling of its own.
 */
export function draftLineKey(newestMessageId: string | undefined, reads: number): string {
  return `draft:${newestMessageId ?? 'none'}:${String(reads)}`;
}
