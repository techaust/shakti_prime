// What leaves the app for Sentry (docs/SECURITY.md §5, docs/design/phase1.md §5.2). Every event,
// transaction and breadcrumb passes through here in `beforeSend`, `beforeSendTransaction` and
// `beforeBreadcrumb`, on the server and in the browser: the same redaction as the log lines
// (`redact` and `redactText` of the logger), no cookies, headers, query strings or bodies, and no
// person but the principal's id. Pure functions over the event's plain shape, so they can be
// tested without the SDK; the browser loads this module only with the SDK, after the page is
// interactive.

import { redact, redactText } from '@shakti/domain/redaction';

/** The only tags an event keeps: who acted (an id) and which request it was. */
export const KEPT_TAGS: readonly string[] = ['principalId', 'requestId'];

type Loose = Record<string, unknown>;

const isObject = (value: unknown): value is Loose =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A URL without its query string or fragment, which may carry a reset link or a search. */
export function withoutQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/** Text as the logs keep it, a URL without its query string. */
function scrubText(value: unknown): unknown {
  return typeof value === 'string' ? redactText(withoutQuery(value)) : value;
}

/** The request part: its method and path only. */
function scrubRequest(request: unknown): Loose | undefined {
  if (!isObject(request)) return undefined;
  const out: Loose = {};
  if (typeof request.method === 'string') out.method = request.method;
  if (typeof request.url === 'string') out.url = redactText(withoutQuery(request.url));
  return out;
}

/** Tags cut to `KEPT_TAGS`, each an id-like value or dropped. */
function scrubTags(tags: unknown): Loose | undefined {
  if (!isObject(tags)) return undefined;
  const out: Loose = {};
  for (const key of KEPT_TAGS) {
    const value = tags[key];
    if (typeof value === 'string' && /^[\w.:-]{1,128}$/.test(value)) out[key] = value;
  }
  return out;
}

/** A stack frame without its local variables, which may hold anything the code was handling. */
function scrubFrame(frame: unknown): unknown {
  if (!isObject(frame)) return frame;
  const rest = Object.fromEntries(Object.entries(frame).filter(([key]) => key !== 'vars'));
  return {
    ...rest,
    ...(typeof rest.abs_path === 'string' ? { abs_path: withoutQuery(rest.abs_path) } : {}),
    ...(typeof rest.filename === 'string' ? { filename: withoutQuery(rest.filename) } : {}),
  };
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

/** A breadcrumb with its message scrubbed as text and its data as a log line's fields. */
export function scrubBreadcrumb<B extends object>(breadcrumb: B): B {
  const crumb = breadcrumb as Loose;
  const out: Loose = { ...crumb };
  if ('message' in crumb) out.message = scrubText(crumb.message);
  if (isObject(crumb.data)) {
    const data: Loose = {};
    for (const [key, value] of Object.entries(crumb.data)) {
      data[key] = key === 'url' || key === 'from' || key === 'to' ? scrubText(value) : value;
    }
    out.data = redact(data);
  }
  return out as B;
}

/**
 * An error or transaction event as Sentry may receive it: the request cut to its method and path,
 * the person to their principal id, the tags to `KEPT_TAGS`, and every message, exception value,
 * breadcrumb, span and extra or context field redacted as the logs are; stack frames lose their
 * local variables.
 */
export function scrubEvent<E extends object>(event: E): E {
  const source = event as Loose;
  const out: Loose = { ...source };
  const request = scrubRequest(source.request);
  if (request === undefined) delete out.request;
  else out.request = request;
  const user = source.user;
  if (isObject(user) && typeof user.id === 'string') out.user = { id: user.id };
  else delete out.user;
  const tags = scrubTags(source.tags);
  if (tags === undefined) delete out.tags;
  else out.tags = tags;
  delete out.server_name;
  delete out.modules;
  if ('message' in source) out.message = scrubText(source.message);
  if (isObject(source.logentry)) {
    out.logentry = { message: scrubText(source.logentry.message) };
  }
  if ('transaction' in source) out.transaction = scrubText(source.transaction);
  if ('exception' in source) out.exception = scrubException(source.exception);
  if (isObject(source.extra)) out.extra = redact(source.extra);
  if (isObject(source.contexts)) out.contexts = redact(source.contexts);
  if (Array.isArray(source.breadcrumbs)) {
    out.breadcrumbs = source.breadcrumbs.map((b: unknown) =>
      isObject(b) ? scrubBreadcrumb(b) : b,
    );
  }
  if (Array.isArray(source.spans)) {
    out.spans = source.spans.map((span: unknown) => {
      if (!isObject(span)) return span;
      return {
        ...span,
        ...('description' in span ? { description: scrubText(span.description) } : {}),
        ...(isObject(span.data) ? { data: redact(span.data) } : {}),
      };
    });
  }
  return out as E;
}
