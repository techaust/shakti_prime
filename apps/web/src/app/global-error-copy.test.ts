import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import { GLOBAL_ERROR_COPY } from './global-error-copy';

describe('the last-resort error page copy', () => {
  it('is the catalogue’s own words', () => {
    expect(GLOBAL_ERROR_COPY).toEqual({
      title: en.errorPage.title,
      body: en.errorPage.body,
      home: en.errorPage.home,
      reference: en.app.reference,
    });
  });
});
