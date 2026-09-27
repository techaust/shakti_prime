import type { IntlError } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { logger } from '../log';
import en from '../../messages/en.json';

/**
 * One English catalogue for every screen (ADR 0014). Dates are formatted in IST. A missing key
 * is reported to the logs and shows nothing, rather than a key path on screen (AUDIT M44).
 */
export default getRequestConfig(() =>
  Promise.resolve({
    locale: 'en',
    messages: en,
    timeZone: 'Asia/Kolkata',
    onError: (error: IntlError) => {
      logger.log('warn', 'i18n.message_missing', { code: error.code, message: error.message });
    },
    getMessageFallback: () => '',
  }),
);
