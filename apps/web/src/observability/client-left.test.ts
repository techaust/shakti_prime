import { describe, expect, it } from 'vitest';
import { clientLeft } from './client-left';

describe('clientLeft (a browser that left a page while it loaded)', () => {
  it("knows React's error for a response stream that closed under the render", () => {
    expect(clientLeft(new Error('The destination stream closed early.'))).toBe(true);
  });

  it("knows Next's own error for an aborted response", () => {
    const aborted = new Error('');
    aborted.name = 'ResponseAborted';
    expect(clientLeft(aborted)).toBe(true);
  });

  it('follows the causes an error was raised from', () => {
    const left = new Error('The destination stream closed early.');
    expect(clientLeft(new Error('the render failed', { cause: left }))).toBe(true);
  });

  it('keeps every other error, stream errors among them, as the app’s', () => {
    for (const error of [
      new Error('render failed'),
      new Error('The destination stream closed early'),
      new Error('Premature close'),
      Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
      new TypeError('Cannot read properties of undefined'),
      'The destination stream closed early.',
      { message: 'The destination stream closed early.' },
      undefined,
      null,
    ]) {
      expect(clientLeft(error)).toBe(false);
    }
  });

  it('stops following causes after a few, so a loop of causes ends', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    a.cause = b;
    expect(clientLeft(a)).toBe(false);
  });
});
