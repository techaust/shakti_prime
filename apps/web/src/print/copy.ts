// Printed words come from the message catalogue like every other string a person reads
// (docs/08-design-system.md §11.4), so the copy lint checks them.
import { createTranslator } from 'next-intl';
import en from '../../messages/en.json';

export function printCopy() {
  return createTranslator({
    locale: 'en',
    messages: en,
    namespace: 'print',
    timeZone: 'Asia/Kolkata',
  });
}

export type PrintCopy = ReturnType<typeof printCopy>;
