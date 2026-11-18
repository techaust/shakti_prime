import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../messages/en.json';
import { SuggestedDraft } from './draft-line';

vi.mock('../../actions/agents', () => ({
  approveSuggestion: vi.fn(),
  editSuggestion: vi.fn(),
  rejectSuggestion: vi.fn(),
}));
vi.mock('../../actions/concierge', () => ({ loadConciergeDraft: vi.fn() }));

// The assistant's draft under Suggest (A3's fix round, L2): a suggestion is decided in the Agent
// Inbox, where it is dismissed, so the chat shows it with the way there and no send, edit or
// discard, which would fail.

describe('a draft under Suggest', () => {
  it('is shown with the way to the Agent Inbox, and nothing to send, edit or discard', () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Kolkata">
        <SuggestedDraft
          draft={{
            itemId: '01990000-0000-7000-8000-00000000f001',
            body: 'Thank you. How deep is your bore, in feet?',
            createdAt: '2026-11-18T06:30:00.000Z',
            decidable: false,
          }}
        />
      </NextIntlClientProvider>,
    );
    expect(html).toContain('Thank you. How deep is your bore, in feet?');
    expect(html).toContain('href="/inbox"');
    expect(html).toContain('Open the Agent Inbox');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('aria-keyshortcuts');
  });
});
