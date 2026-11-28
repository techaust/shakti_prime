import en from '../messages/en.json';

/**
 * The field app's words, all from its catalogue (`messages/en.json`), which the copy lint checks
 * like the website's (docs/08-design-system.md §11). Messages take `{name}` values and one plural
 * form, `{count, plural, one {…} other {…}}`, with `#` for the number.
 */
type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<typeof en>;
export type MessageValues = Readonly<Record<string, string | number>>;

function lookup(key: string): string {
  let node: unknown = en;
  for (const part of key.split('.')) {
    node =
      typeof node === 'object' && node !== null
        ? (node as Record<string, unknown>)[part]
        : undefined;
  }
  return typeof node === 'string' ? node : key;
}

const PLURAL = /\{(\w+), plural, one \{([^{}]*)\} other \{([^{}]*)\}\}/g;

export function format(message: string, values: MessageValues = {}): string {
  return message
    .replace(PLURAL, (_whole, name: string, one: string, other: string) => {
      const count = Number(values[name] ?? 0);
      return (count === 1 ? one : other).replaceAll('#', String(count));
    })
    .replace(/\{(\w+)\}/g, (whole, name: string) => {
      const value = values[name];
      return value === undefined ? whole : String(value);
    });
}

/** The catalogue's sentence for `key`, with its values filled in. */
export function t(key: MessageKey, values?: MessageValues): string {
  return format(lookup(key), values);
}

/** A key of the `errors` block, for a reason the server or the app gives. */
export function errorKey(reason: string): MessageKey {
  return reason in en.errors ? (`errors.${reason}` as MessageKey) : 'errors.unexpected';
}
