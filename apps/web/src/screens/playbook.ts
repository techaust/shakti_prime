import type { PlaybookDirectiveDto, PlaybookReviewDto } from '@shakti/contracts';

// The Playbook screen's pure parts (docs/03-roadmap-appendix/phase2.md §5.4): its keys, moving
// through the list, and which pairs of a review still block approval.

export type PlaybookShortcut = 'next' | 'previous' | 'approve';

/** The screen's keys: J the next rule, K the one before, A approve; none with a modifier held. */
export function playbookShortcut(event: {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): PlaybookShortcut | undefined {
  if (event.altKey || event.ctrlKey || event.metaKey) return undefined;
  switch (event.key) {
    case 'j':
    case 'J':
      return 'next';
    case 'k':
    case 'K':
      return 'previous';
    case 'a':
    case 'A':
      return 'approve';
    default:
      return undefined;
  }
}

/**
 * The rule `step` places after (1) or before (-1) the current one, staying at either end; the
 * first rule when none is chosen.
 */
export function stepDirective(
  list: readonly Pick<PlaybookDirectiveDto, 'id'>[],
  currentId: string | undefined,
  step: 1 | -1,
): string | undefined {
  if (list.length === 0) return undefined;
  const at = list.findIndex((d) => d.id === currentId);
  if (at === -1) return list[0]?.id;
  return list[Math.min(list.length - 1, Math.max(0, at + step))]?.id;
}

/** The pairs of a review a person must still settle: not labelled `none`, not resolved. */
export function openPairs(review: PlaybookReviewDto): PlaybookReviewDto['pairs'] {
  return review.pairs.filter((p) => p.check.label !== 'none' && p.check.resolvedAt === null);
}

/** Whether the rule can be approved now, as the screen shows it; the command decides. */
export function approvable(review: PlaybookReviewDto): boolean {
  return (
    review.directive.state === 'draft' &&
    review.directive.checkedAt !== null &&
    openPairs(review).length === 0
  );
}
