import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { percentOf, phaseAfter, pickProblem, UploaderView, type UploaderPhase } from './uploader';

const text = {
  choose: 'Choose a file',
  drop: 'or drop it here',
  cancel: 'Cancel upload',
  retry: 'Try again',
  started: 'Uploading the file.',
  halfway: 'Uploading, half done.',
  cancelled: 'Upload cancelled.',
  failed: 'The upload did not finish.',
  wrongType: 'Wrong kind of file.',
  tooLarge: 'Too large.',
  empty: 'Empty file.',
};

const ACCEPT = ['image/png', 'image/jpeg'];

function view(phase: UploaderPhase, extra: { disabled?: boolean; hint?: string } = {}): string {
  return renderToStaticMarkup(
    <UploaderView
      id="logo"
      label="Logo"
      accept={ACCEPT}
      phase={phase}
      text={text}
      onPick={() => undefined}
      onCancel={() => undefined}
      onRetry={() => undefined}
      {...extra}
    />,
  );
}

describe('the uploader’s checks before sending', () => {
  it('takes a file of an accepted type within the limit, up to the last byte', () => {
    expect(pickProblem({ type: 'image/png', size: 10 }, ACCEPT, 10)).toBeUndefined();
  });

  it('refuses another type, one byte too many, and an empty file', () => {
    expect(pickProblem({ type: 'application/pdf', size: 1 }, ACCEPT, 10)).toBe('wrongType');
    expect(pickProblem({ type: '', size: 1 }, ACCEPT, 10)).toBe('wrongType');
    expect(pickProblem({ type: 'image/png', size: 11 }, ACCEPT, 10)).toBe('tooLarge');
    expect(pickProblem({ type: 'image/png', size: 0 }, ACCEPT, 10)).toBe('empty');
  });

  it('counts progress in whole percent and reaches 100 only at the end', () => {
    expect(percentOf(0, 200)).toBe(0);
    expect(percentOf(1, 200)).toBe(0);
    expect(percentOf(199, 200)).toBe(99);
    expect(percentOf(200, 200)).toBe(100);
    expect(percentOf(5, 0)).toBe(0);
  });
});

describe('UploaderView', () => {
  it('labels the file control, lists the kinds it takes and ties the hint and status to it', () => {
    const html = view({ kind: 'idle' }, { hint: 'PNG or JPEG, up to 2 MB' });
    expect(html).toContain('<label id="logo-label" for="logo"');
    expect(html).toContain('type="file"');
    expect(html).toContain('accept="image/png,image/jpeg"');
    expect(html).toContain('aria-describedby="logo-hint logo-status"');
    // The button is the control a keyboard reaches, named by the field's label and its own words.
    expect(html).toMatch(/type="file"[^>]*tabindex="-1"/);
    expect(html).toContain('aria-labelledby="logo-label logo-choose"');
    expect(html).toContain('id="logo-hint"');
    expect(html).toContain('Choose a file');
    expect(html).toContain('or drop it here');
    // The outcome is announced as it changes.
    expect(html).toMatch(/id="logo-status" role="status" aria-live="polite"/);
  });

  it('shows progress with its value while sending, and offers Cancel', () => {
    const html = view({ kind: 'uploading', fileName: 'logo.png', percent: 42 });
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-labelledby="logo-label"');
    expect(html).toContain('aria-valuenow="42"');
    expect(html).toContain('width:42%');
    expect(html).toContain('Cancel upload');
    // Nothing else may be picked while one file is on its way.
    expect(html).toMatch(/type="file"[^>]*disabled=""/);
    expect(html).not.toContain('Try again');
  });

  it('announces only the milestones while the bar carries the value', () => {
    const status = (percent: number) =>
      /id="logo-status"[^>]*>(?:<svg[^>]*>.*?<\/svg>)?([^<]*)</.exec(
        view({ kind: 'uploading', fileName: 'a.png', percent }),
      )?.[1];
    expect(status(0)).toBe('Uploading the file.');
    expect(status(49)).toBe('Uploading the file.');
    expect(status(50)).toBe('Uploading, half done.');
    expect(status(99)).toBe('Uploading, half done.');
  });

  it('offers Try again after a failure it can retry, and not after one it cannot', () => {
    const retry = view({
      kind: 'failed',
      fileName: 'a.png',
      message: 'It stopped.',
      canRetry: true,
    });
    expect(retry).toContain('It stopped.');
    expect(retry).toContain('Try again');
    expect(retry).toContain('text-danger');
    const final = view({ kind: 'failed', fileName: 'a.png', message: 'Refused.', canRetry: false });
    expect(final).not.toContain('Try again');
  });

  it('gives the outcome in the caller’s words', () => {
    expect(view({ kind: 'done', fileName: 'a.png', message: 'Saved.' })).toContain('Saved.');
    expect(view({ kind: 'done', fileName: 'a.png', message: 'Saved.' })).toContain('text-success');
    expect(view({ kind: 'waiting', fileName: 'a.png', message: 'Checking.' })).toContain(
      'Checking.',
    );
    expect(view({ kind: 'refused', message: 'Too large.' })).toContain('Too large.');
    expect(view({ kind: 'cancelled', message: 'Upload cancelled.' })).toContain(
      'Upload cancelled.',
    );
  });

  it('can be switched off', () => {
    expect(view({ kind: 'idle' }, { disabled: true })).toMatch(/type="file"[^>]*disabled=""/);
  });
});

describe('how an upload ends', () => {
  it('shows the general failure sentence when the upload threw', () => {
    expect(phaseAfter('a.png', undefined, false, text)).toEqual({
      kind: 'failed',
      fileName: 'a.png',
      message: 'The upload did not finish.',
      canRetry: true,
    });
  });

  it('shows it too for a failure that gave no sentence, and the caller’s sentence otherwise', () => {
    expect(
      phaseAfter('a.png', { status: 'failed', message: '', canRetry: false }, false, text),
    ).toMatchObject({ message: 'The upload did not finish.', canRetry: false });
    expect(
      phaseAfter('a.png', { status: 'failed', message: 'Refused.', canRetry: false }, false, text),
    ).toMatchObject({ message: 'Refused.' });
  });

  it('says it was cancelled, whatever the upload answered', () => {
    expect(phaseAfter('a.png', { status: 'done', message: 'Saved.' }, true, text)).toEqual({
      kind: 'cancelled',
      message: 'Upload cancelled.',
    });
  });

  it('keeps the caller’s outcome of a finished upload', () => {
    expect(phaseAfter('a.png', { status: 'waiting', message: 'Checking.' }, false, text)).toEqual({
      kind: 'waiting',
      fileName: 'a.png',
      message: 'Checking.',
    });
  });
});
