import type { ChecklistItem, QcAnswer } from '@shakti/contracts';

/**
 * Whether a quality check's answers fill its checklist (docs/03-roadmap-appendix/phase4.md §7.3):
 * one answer per item and none besides, each of the item's kind, a number within the item's
 * bounds. A pure check, read by the `qc_inspection` machine's guard `qc_answers_missing`.
 */
export function answersFillChecklist(
  items: readonly ChecklistItem[],
  answers: readonly QcAnswer[],
): boolean {
  if (items.length === 0 || answers.length !== items.length) return false;
  const byKey = new Map(answers.map((a) => [a.key, a.value]));
  if (byKey.size !== answers.length) return false;
  return items.every((item) => {
    const value = byKey.get(item.key);
    switch (item.kind) {
      case 'yes_no':
        return typeof value === 'boolean';
      case 'number':
        return (
          typeof value === 'number' &&
          Number.isFinite(value) &&
          (item.min === null || value >= item.min) &&
          (item.max === null || value <= item.max)
        );
      case 'text':
        return typeof value === 'string' && value.trim().length > 0;
      case 'photo_required':
        return Array.isArray(value) && value.length > 0;
    }
  });
}

/** Every photo the answers name, each once, in the order of the answers. */
export function photoIdsOf(answers: readonly QcAnswer[]): string[] {
  return [...new Set(answers.flatMap((a) => (Array.isArray(a.value) ? a.value : [])))];
}
