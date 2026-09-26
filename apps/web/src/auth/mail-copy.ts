import { LocaleSchema, type Locale } from '@shakti/contracts';
import { createTranslator } from 'next-intl';
import en from '../../messages/en.json';
import hi from '../../messages/hi.json';

const MESSAGES: Record<Locale, typeof en> = { en, hi };

/** Catalogue lookup outside a request, for mail sent by the auth module. */
export function mailTranslator(locale: unknown) {
  const parsed = LocaleSchema.safeParse(locale);
  const chosen: Locale = parsed.success ? parsed.data : 'en';
  return createTranslator({ locale: chosen, messages: MESSAGES[chosen], namespace: 'mail' });
}
