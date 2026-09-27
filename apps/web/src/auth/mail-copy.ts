import { createTranslator } from 'next-intl';
import en from '../../messages/en.json';

/** Catalogue lookup outside a request, for mail sent by the auth module. Mail is English (ADR 0014). */
export function mailTranslator() {
  return createTranslator({ locale: 'en', messages: en, namespace: 'mail' });
}
