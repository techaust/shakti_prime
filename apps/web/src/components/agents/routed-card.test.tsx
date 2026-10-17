import type { InboxItemDto } from '@shakti/contracts';
import type { FocusTargets } from '@shakti/ui';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../messages/en.json';
import { RoutedCard } from './inbox-screen';

vi.mock('../../actions/agents', () => ({
  approveSuggestion: vi.fn(),
  completeRoutedWork: vi.fn(),
  dismissSuggestion: vi.fn(),
  listInbox: vi.fn(),
  rejectSuggestion: vi.fn(),
}));

function routed(consentChannel: InboxItemDto['consentChannel']): InboxItemDto {
  return {
    id: '01990000-0000-7000-8000-00000000c001',
    entityId: 1,
    kind: 'routed_work',
    agent: null,
    actionType: null,
    autonomy: null,
    subjectType: 'account',
    subjectId: '01990000-0000-7000-8000-00000000c002',
    subjectName: 'Ramesh Patil',
    accountId: '01990000-0000-7000-8000-00000000c002',
    assigneeId: '01990000-0000-7000-8000-00000000c003',
    summary: [],
    fields: [],
    segment: 'farmer_pumps',
    note: null,
    consentChannel,
    createdAt: '2026-10-17T06:30:00.000Z',
  };
}

const cards = { ref: () => () => undefined } as unknown as FocusTargets<string>;

function render(item: InboxItemDto): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Kolkata">
      <RoutedCard
        item={item}
        focusable
        company={undefined}
        cards={cards}
        decisions={{ current: new Map() }}
        onFocus={() => undefined}
        onDone={() => undefined}
      />
    </NextIntlClientProvider>,
  );
}

describe('a routed enquiry’s card says a consent came with it (#4, owner 17-10-2026)', () => {
  it('says consent to calls was given with the enquiry', () => {
    expect(render(routed('call'))).toContain(
      'Consent to phone calls was given with this enquiry and is recorded on the customer.',
    );
  });

  it('names the channel the consent was given for', () => {
    expect(render(routed('whatsapp'))).toContain('Consent to WhatsApp messages was given');
  });

  it('says nothing of consent when none came with the enquiry', () => {
    const html = render(routed(null));
    expect(html).toContain('Ramesh Patil asked again');
    expect(html).not.toContain('Consent to');
  });
});
