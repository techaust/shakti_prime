import { normaliseKey, redact, redactText } from '@shakti/contracts/masking';

/**
 * What leaves the field app for Sentry (docs/07-security.md §5), by the web's rules
 * (`apps/web/src/observability/sentry-scrub.ts`): every event, transaction and breadcrumb the
 * JavaScript side sends passes through here in `beforeSend`, `beforeSendTransaction` and
 * `beforeBreadcrumb`. A request keeps its method and path only; the person, their id only; every
 * field goes through the logs' own redaction (`redact` of `@shakti/contracts/masking`: secret and
 * identity fields hidden, a number of ten digits or more hidden, text scrubbed of links, tokens,
 * email and UPI addresses, phone numbers to their last four digits and identity numbers whole),
 * after the fields only a phone carries (its PIN, codes, installation id, headers and bodies) are
 * dropped; stack frames lose their local variables. A native Android crash skips these functions
 * and carries the scope the SDK copies from JavaScript, so the app sets nothing on Sentry's scope
 * (SECURITY §2, Mobile). Pure functions over the event's plain shape, so they are tested without
 * the SDK.
 */

type Loose = Record<string, unknown>;

const isObject = (value: unknown): value is Loose =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Fields that never leave the phone beyond those `redact` hides itself, compared without case or
 * separators: the PIN and an authenticator or backup code (which `redact` would keep as codes),
 * the installation id, and request headers and bodies.
 */
const PHONE_SECRET_KEYS: ReadonlySet<string> = new Set([
  'authorization',
  'cookie',
  'pin',
  'totpcode',
  'backupcode',
  'backupcodes',
  'deviceid',
  'sid',
  'headers',
  'body',
]);

const isPhoneSecretKey = (key: string): boolean => PHONE_SECRET_KEYS.has(normaliseKey(key));

/** Fields whose value is an address or a path: their query string and fragment are cut. */
const ADDRESS_KEY = /path|url|uri|target|href|^from$|^to$/i;

/** A URL without its query string or fragment, which may carry a token or a search. */
export function withoutQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

const scrubText = (value: unknown): unknown =>
  typeof value === 'string' ? redactText(withoutQuery(value)) : value;

/** A copy without the phone's own secret fields, and with every address cut to its path. */
function withoutPhoneSecrets(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (Array.isArray(value)) return value.map((v) => withoutPhoneSecrets(v, depth + 1));
  if (!isObject(value)) return value;
  const out: Loose = {};
  for (const [key, field] of Object.entries(value)) {
    if (isPhoneSecretKey(key)) continue;
    out[key] =
      typeof field === 'string' && ADDRESS_KEY.test(key)
        ? withoutQuery(field)
        : withoutPhoneSecrets(field, depth + 1);
  }
  return out;
}

/** Any value as the web's Sentry and the logs keep it, without the phone's own secrets. */
export function scrubFields(value: unknown): unknown {
  return redact(withoutPhoneSecrets(value));
}

function scrubFrame(frame: unknown): unknown {
  if (!isObject(frame)) return frame;
  const out: Loose = Object.fromEntries(Object.entries(frame).filter(([key]) => key !== 'vars'));
  for (const key of ['abs_path', 'filename', 'function', 'module'] as const) {
    if (typeof out[key] === 'string') out[key] = scrubText(out[key]);
  }
  return out;
}

function scrubException(exception: unknown): unknown {
  if (!isObject(exception) || !Array.isArray(exception.values)) return exception;
  return {
    ...exception,
    values: exception.values.map((value: unknown) => {
      if (!isObject(value)) return value;
      const stack = value.stacktrace;
      return {
        ...value,
        value: scrubText(value.value),
        ...(isObject(stack) && Array.isArray(stack.frames)
          ? { stacktrace: { ...stack, frames: stack.frames.map(scrubFrame) } }
          : {}),
      };
    }),
  };
}

/** A breadcrumb with its message scrubbed as text and its data as fields. */
export function scrubBreadcrumb<B extends object>(breadcrumb: B): B {
  const crumb = breadcrumb as Loose;
  const out: Loose = { ...crumb };
  if ('message' in crumb) out.message = scrubText(crumb.message);
  if (isObject(crumb.data)) out.data = scrubFields(crumb.data);
  return out as B;
}

/**
 * An event as Sentry may receive it: the request cut to its method and path, the person to their
 * id, no tags, and every message, exception, breadcrumb, span, extra and context field scrubbed;
 * the phone's own name (which may be its owner's) is dropped.
 */
export function scrubEvent<E extends object>(event: E): E {
  const source = event as Loose;
  const out: Loose = { ...source };
  const request = source.request;
  if (isObject(request)) {
    out.request = {
      ...(typeof request.method === 'string' ? { method: request.method } : {}),
      ...(typeof request.url === 'string' ? { url: redactText(withoutQuery(request.url)) } : {}),
    };
  } else delete out.request;
  const user = source.user;
  if (isObject(user) && typeof user.id === 'string') out.user = { id: user.id };
  else delete out.user;
  delete out.tags;
  delete out.server_name;
  if ('message' in source) out.message = scrubText(source.message);
  if (isObject(source.logentry)) out.logentry = { message: scrubText(source.logentry.message) };
  if ('transaction' in source) out.transaction = scrubText(source.transaction);
  if ('exception' in source) out.exception = scrubException(source.exception);
  if (isObject(source.extra)) out.extra = scrubFields(source.extra);
  if (isObject(source.contexts)) {
    const contexts = scrubFields(source.contexts) as Loose;
    if (isObject(contexts.device)) {
      const device = { ...contexts.device };
      delete device.name;
      contexts.device = device;
    }
    out.contexts = contexts;
  }
  if (Array.isArray(source.breadcrumbs)) {
    out.breadcrumbs = source.breadcrumbs.map((b: unknown) =>
      isObject(b) ? scrubBreadcrumb(b) : b,
    );
  }
  if (Array.isArray(source.spans)) {
    out.spans = source.spans.map((span: unknown) =>
      isObject(span)
        ? {
            ...span,
            ...('description' in span ? { description: scrubText(span.description) } : {}),
            ...(isObject(span.data) ? { data: scrubFields(span.data) } : {}),
          }
        : span,
    );
  }
  return out as E;
}
