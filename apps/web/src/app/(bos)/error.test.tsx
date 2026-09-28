import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../messages/en.json';
import { referenceFromDigest } from '../../reference';
import BosErrorScreen from './error';

function render(error: Error & { digest?: string }) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Kolkata">
      <BosErrorScreen error={error} reset={vi.fn()} retry={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

describe('the error screen inside the app shell', () => {
  it('says what happened in the plain sentence, with a retry and a way home', () => {
    const html = render(new Error('relation "opportunities" does not exist'));
    expect(html).toContain(`<h1 class="text-h1 tracking-[-0.01em]">${en.errorPage.title}</h1>`);
    expect(html).toContain(en.errorPage.body);
    expect(html).toMatch(
      new RegExp(`<button type="button"[^>]*><span[^>]*>${en.errorPage.retry}</span></button>`),
    );
    expect(html).toMatch(new RegExp(`<a[^>]*href="/home"[^>]*>${en.errorPage.home}</a>`));
    expect(html).toContain('role="alert"');
  });

  it('never shows the technical message of the error', () => {
    const html = render(new Error('relation "opportunities" does not exist'));
    expect(html).not.toContain('opportunities');
    expect(html).not.toContain('relation');
  });

  it('shows the reference support looks up, when the server gave one', () => {
    const error = Object.assign(new Error('secret detail'), { digest: '2485719236' });
    const reference = referenceFromDigest('2485719236');
    const html = render(error);
    expect(html).toContain(en.app.reference.replace('{reference}', reference));
    expect(html).not.toContain('2485719236');
    expect(html).not.toContain('secret detail');
    expect(render(new Error('x'))).not.toContain(reference);
  });

  it('renders as a screen of the shell, not a page of its own', () => {
    const html = render(new Error('x'));
    // The shell's layout owns <main> and the document; this is only the content area.
    expect(html).not.toContain('<main');
    expect(html).not.toContain('min-h-dvh');
    expect(html).toContain('max-w-form');
  });
});
