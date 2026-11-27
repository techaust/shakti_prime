import type { ReactNode } from 'react';
import { formatDate } from '../../screens/format';

/**
 * A calendar date (`YYYY-MM-DD`) for a rich message's `<time>` tag, as `momentValues` gives a
 * moment: the date as people read it, inside a `time` element the screenshots mask.
 */
export function dayValues(iso: string): { when: string; time: (chunks: ReactNode) => ReactNode } {
  return { when: formatDate(iso), time: (chunks) => <time dateTime={iso}>{chunks}</time> };
}
