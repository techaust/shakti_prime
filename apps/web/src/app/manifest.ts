import { colors } from '@shakti/tokens';
import type { MetadataRoute } from 'next';
import { getTranslations } from 'next-intl/server';

/** The web app's manifest: the name and the Spark S icons a phone shows when the app is added to its home screen. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getTranslations('app');
  return {
    name: t('name'),
    short_name: t('name'),
    description: t('tagline'),
    start_url: '/home',
    display: 'standalone',
    background_color: colors.bg.light,
    theme_color: colors.accent.light,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
