import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const config: NextConfig = {
  typedRoutes: true,
  transpilePackages: ['@shakti/contracts', '@shakti/db', '@shakti/domain', '@shakti/tokens'],
  serverExternalPackages: ['postgres'],
  poweredByHeader: false,
};

export default withNextIntl(config);
