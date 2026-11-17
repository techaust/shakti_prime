import { describe, expect, it } from 'vitest';
import { mintRingingTicket, readRingingTicket, RINGING_TICKET_SECONDS } from './ticket';

const PERSON = '01a1e99a-b000-7000-8000-000000000001';
const ENV = { BETTER_AUTH_SECRET: 'a ticket phrase for the screen pop tests only' };
const NOW = new Date('2026-11-17T06:30:00.000Z');

describe('the screen-pop ticket', () => {
  it('names its person until it ends, and nobody after', () => {
    const { ticket, expiresAt } = mintRingingTicket(PERSON, NOW, ENV);
    expect(expiresAt).toBe(new Date(NOW.getTime() + RINGING_TICKET_SECONDS * 1000).toISOString());
    expect(readRingingTicket(ticket, NOW, ENV)).toBe(PERSON);
    expect(readRingingTicket(ticket, new Date(Date.parse(expiresAt)), ENV)).toBeUndefined();
  });

  it('refuses a ticket signed with another secret, changed, or not a ticket at all', () => {
    const { ticket } = mintRingingTicket(PERSON, NOW, ENV);
    expect(
      readRingingTicket(ticket, NOW, { BETTER_AUTH_SECRET: 'another phrase' }),
    ).toBeUndefined();
    const other = '01a1e99a-b000-7000-8000-000000000002';
    expect(readRingingTicket(ticket.replace(PERSON, other), NOW, ENV)).toBeUndefined();
    const [, ends, signature] = ticket.split('.');
    const later = `${PERSON}.${String(Number(ends) + 3600)}.${signature ?? ''}`;
    expect(readRingingTicket(later, NOW, ENV)).toBeUndefined();
    for (const bad of [undefined, null, '', 'x', `${ticket}.more`, 'a'.repeat(500)]) {
      expect(readRingingTicket(bad, NOW, ENV)).toBeUndefined();
    }
  });
});
