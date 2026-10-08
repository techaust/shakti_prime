import { ThemeSchema } from '@shakti/contracts';
import { colors } from '@shakti/tokens';
import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { Inter } from 'next/font/google';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { CLIENT_NAMESPACES } from '../i18n/client-namespaces';
import { requestNonce } from '../nonce';
import { browserSentrySettings } from '../observability/sentry-options';
import { CONTRAST_COOKIE, HIGH_CONTRAST, isHighContrast, THEME_COOKIE } from '../theme';
import './globals.css';
import { Providers } from './providers';

// Self-hosted at build time, so no request goes to a font service at run time (docs/08-design-system.md §3).
// The variable font carries the optical-size axis: headings get Inter's display cut.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  axes: ['opsz'],
  display: 'swap',
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app');
  return {
    title: { default: t('name'), template: `%s · ${t('name')}` },
    description: t('tagline'),
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: colors.bg.light },
    { media: '(prefers-color-scheme: dark)', color: colors.bg.dark },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The profile's theme, mirrored in a cookie so the first paint on a device already uses it, and
  // this device's higher-contrast choice.
  const jar = await cookies();
  const saved = ThemeSchema.safeParse(jar.get(THEME_COOKIE)?.value);
  const high = isHighContrast(jar.get(CONTRAST_COOKIE)?.value);
  const messages = await getMessages();
  const clientMessages = Object.fromEntries(CLIENT_NAMESPACES.map((ns) => [ns, messages[ns]]));
  return (
    <html
      lang="en"
      className={inter.variable}
      data-contrast={high ? HIGH_CONTRAST : undefined}
      suppressHydrationWarning
    >
      <body>
        <Providers
          defaultTheme={saved.success ? saved.data : 'system'}
          nonce={await requestNonce()}
          sentry={browserSentrySettings()}
        >
          <NextIntlClientProvider messages={clientMessages}>{children}</NextIntlClientProvider>
        </Providers>
      </body>
    </html>
  );
}
