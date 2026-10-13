import type { ReactNode } from 'react';
import { formatDateTime } from '../screens/format';

/**
 * A moment as people read it (the date and the IST time), marked up as a time: assistive
 * technology can read the exact moment, and the end-to-end screenshots mask every `time`.
 */
export function DateTime({ value }: { value: Date | string }) {
  const date = typeof value === 'string' ? new Date(value) : value;
  return <time dateTime={date.toISOString()}>{formatDateTime(date)}</time>;
}

/**
 * The values of a message that holds a moment inside its sentence (`"Held since
 * <time>{when}</time>"`), so the words around the date stay one message in the catalogue
 * (docs/08-design-system.md §9): `t.rich('heldSince', momentValues(order.heldAt))`. The moment is
 * marked up as `DateTime` marks it.
 */
export function momentValues(value: Date | string): {
  when: string;
  time: (chunks: ReactNode) => ReactNode;
} {
  const date = typeof value === 'string' ? new Date(value) : value;
  return {
    when: formatDateTime(date),
    time: (chunks) => <time dateTime={date.toISOString()}>{chunks}</time>,
  };
}
