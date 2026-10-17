import type { AuditLogDto } from '@shakti/contracts';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../messages/en.json';
import { ActivityDetails } from './activity-details';

vi.mock('../../actions/admin', () => ({ listUserSessions: vi.fn(), revokeSession: vi.fn() }));
// The sheet's title parts need the dialog they sit in; here the details render on their own.
vi.mock('@shakti/ui', async (original) => ({
  ...(await original<typeof import('@shakti/ui')>()),
  SheetHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  SheetDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));

function row(command: string, aggregateType: string | null): AuditLogDto {
  return {
    id: '01990000-0000-7000-8000-00000000b001',
    entityId: 1,
    actorPrincipalId: '01990000-0000-7000-8000-00000000b002',
    actorKind: 'user',
    actorName: 'Asha Patel',
    onBehalfOfUserId: null,
    command,
    aggregateType,
    aggregateId: '01990000-0000-7000-8000-00000000b003',
    outcome: 'ok',
    errorCode: null,
    input: {},
    before: { state: 'open' },
    after: { state: 'dismissed' },
    ip: null,
    device: null,
    requestId: null,
    createdAt: '2026-10-17T06:30:00.000Z',
  };
}

function render(entry: AuditLogDto): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Kolkata">
      <ActivityDetails row={entry} companies={{ 1: 'Shakti Supreme' }} />
    </NextIntlClientProvider>,
  );
}

describe('ActivityDetails reads a state by the kind of record it changed', () => {
  it('reads a duplicate card set aside in the duplicates’ words', () => {
    const html = render(row('crm.duplicate.dismiss', 'duplicate_candidate'));
    expect(html).toContain(en.duplicates.state.dismissed);
    expect(html).not.toContain(en.agents.actionState.dismissed);
  });

  it('reads an agent’s action dismissed in the agents’ words', () => {
    const html = render(row('agents.inbox.dismiss', 'agent_action'));
    expect(html).toContain(en.agents.actionState.dismissed);
    expect(html).not.toContain(en.duplicates.state.dismissed);
  });

  it('reads a lead’s state in the leads’ words', () => {
    const lead = { ...row('crm.opportunity.lose', 'opportunity'), after: { state: 'lost' } };
    expect(render(lead)).toContain(en.leads.state.lost);
  });
});
