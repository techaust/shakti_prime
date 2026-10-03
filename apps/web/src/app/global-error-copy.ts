/**
 * The few sentences of the last-resort error page (`global-error.tsx`), kept here so that page
 * does not bring the whole message catalogue into every page's JavaScript. They are the
 * catalogue's own words: `global-error-copy.test.ts` fails when they differ from
 * `messages/en.json`, which stays the place copy is written and checked.
 */
export const GLOBAL_ERROR_COPY = {
  title: 'Something went wrong on our side',
  body: 'Please try again in a minute. If it happens again, tell your manager the reference below.',
  home: 'Go to the home screen',
  reference: 'Reference: {reference}',
} as const;
