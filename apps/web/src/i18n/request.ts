import { getRequestConfig } from 'next-intl/server';
import en from '../../messages/en.json';

/** One English catalogue for every screen (ADR 0014). Dates are formatted in IST. */
export default getRequestConfig(() =>
  Promise.resolve({ locale: 'en', messages: en, timeZone: 'Asia/Kolkata' }),
);
