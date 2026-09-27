// Display formats for the BOS screens (DESIGN.md §9, §11.1 rule 5). They only format values a
// DTO already carries; no screen computes a price, a tax or a total.

import { formatDate, formatRupees } from '../print/format';

export { formatDate, formatRupees };

const IST_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** DD-MM-YYYY HH:mm in IST, 24-hour, for an instant such as a sign-in or a change. */
export function formatDateTime(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return `${formatDate(date)} ${IST_TIME.format(date)}`;
}

/** An Indian mobile in E.164 (`+919812345678`) as people read it: `+91 98123 45678`. */
export function formatPhone(e164: string): string {
  const india = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return india ? `+91 ${india[1] ?? ''} ${india[2] ?? ''}` : e164;
}

const MONEY_TYPED = /^(\d{1,12})(?:\.(\d{1,2}))?$/;

/**
 * What a person types into a price box (`24,750`, `₹ 24750.5`) as the two-decimal money string
 * the API carries (`24750.50`); undefined when it is not an amount. Only the spelling changes:
 * the digits are kept as typed, so no rounding happens here.
 */
export function moneyFromTyped(typed: string): string | undefined {
  const cleaned = typed.replaceAll(/[\s,₹]/g, '');
  const match = MONEY_TYPED.exec(cleaned);
  if (!match) return undefined;
  const [, whole = '', paise = ''] = match;
  return `${whole.replace(/^0+(?=\d)/, '')}.${paise.padEnd(2, '0')}`;
}

/** The part of a browser's description people recognise, such as `Chrome on Android`. */
export interface DeviceDescription {
  browser: 'chrome' | 'edge' | 'firefox' | 'safari' | 'samsung' | 'opera' | 'other';
  system: 'android' | 'iphone' | 'ipad' | 'windows' | 'mac' | 'linux' | 'other';
}

/**
 * Reads the browser and the operating system from a browser's self-description, so a sign-in is
 * shown as "Chrome on Android" and never as the raw text. Order matters: Edge, Opera and Samsung
 * Internet also call themselves Chrome, and Chrome also calls itself Safari.
 */
export function describeDevice(userAgent: string | null): DeviceDescription {
  const ua = userAgent ?? '';
  const browser: DeviceDescription['browser'] = ua.includes('Edg/')
    ? 'edge'
    : /OPR\/|Opera/.test(ua)
      ? 'opera'
      : ua.includes('SamsungBrowser/')
        ? 'samsung'
        : /Firefox\/|FxiOS\//.test(ua)
          ? 'firefox'
          : /Chrome\/|CriOS\//.test(ua)
            ? 'chrome'
            : ua.includes('Safari/')
              ? 'safari'
              : 'other';
  const system: DeviceDescription['system'] = ua.includes('Android')
    ? 'android'
    : ua.includes('iPhone')
      ? 'iphone'
      : ua.includes('iPad')
        ? 'ipad'
        : ua.includes('Windows')
          ? 'windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'mac'
            : /Linux|X11/.test(ua)
              ? 'linux'
              : 'other';
  return { browser, system };
}
