'use server';

// The screen-pop's ticket (docs/03-roadmap-appendix/phase2.md §7.4, `src/calls/ticket.ts`).

import { DomainError, hasGrant } from '@shakti/contracts';
import { mintRingingTicket } from '../calls/ticket';
import { toResult, type ActionResult } from './result';
import { signedInQuietly } from './support';

/**
 * A new ticket for the ringing route, for a person who places calls: asked for by their page before
 * its ticket ends. The screen asks on its own, so the session is checked and never extended (WEB-8).
 */
export async function ringingTicket(): Promise<
  ActionResult<{ ticket: string; expiresAt: string }>
> {
  return toResult('ringingTicket', async () => {
    const principal = await signedInQuietly();
    if (!hasGrant(principal.permissions, 'calls.dial', 'own')) {
      throw new DomainError('forbidden', 'the screen-pop is for people who place calls');
    }
    return mintRingingTicket(principal.id);
  });
}
