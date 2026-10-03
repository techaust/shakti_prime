import { formatDateTime } from '../screens/format';

/**
 * A moment as people read it (the date and the IST time), marked up as a time: assistive
 * technology can read the exact moment, and the end-to-end screenshots mask every `time`.
 */
export function DateTime({ value }: { value: Date | string }) {
  const date = typeof value === 'string' ? new Date(value) : value;
  return <time dateTime={date.toISOString()}>{formatDateTime(date)}</time>;
}
