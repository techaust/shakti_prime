import { cn } from './cn';

/**
 * The letters an avatar shows for a name: the first letter of the first and the last word, or of
 * the only word. Spaces and dots separate words ("R. K. Sharma" is RS), and a name with no
 * letters to show gives an empty string.
 */
export function initials(name: string): string {
  const words = name.split(/[\s.]+/).filter((w) => w !== '');
  const first = words[0];
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  const letter = (word: string | undefined) =>
    word === undefined ? '' : (Array.from(word)[0] ?? '').toLocaleUpperCase('en-IN');
  return `${letter(first)}${letter(last)}`;
}

/**
 * A person's avatar (DESIGN.md §6, Kanban board cards): a small circle with their initials,
 * whose accessible name is the full name. Nothing is drawn for a name with no letters.
 */
export function Avatar({ name, className }: { name: string; className?: string }) {
  const letters = initials(name);
  if (letters === '') return null;
  return (
    <span
      role="img"
      aria-label={name.trim()}
      title={name.trim()}
      className={cn(
        'bg-accent-soft text-accent-text inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs leading-none font-[590] select-none',
        className,
      )}
    >
      <span aria-hidden>{letters}</span>
    </span>
  );
}
