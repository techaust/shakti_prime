import { LocaleSchema, type Locale } from '@shakti/contracts';
import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

/** Locale from the `locale` cookie (profile setting, mirrored for server rendering) or Accept-Language. */
async function resolveLocale(): Promise<Locale> {
  const fromCookie = LocaleSchema.safeParse((await cookies()).get('locale')?.value);
  if (fromCookie.success) return fromCookie.data;
  const accept = (await headers()).get('accept-language') ?? '';
  return accept.toLowerCase().startsWith('hi') ? 'hi' : 'en';
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  const messages = (await import(`../../messages/${locale}.json`)) as {
    default: Record<string, unknown>;
  };
  return { locale, messages: messages.default };
});
