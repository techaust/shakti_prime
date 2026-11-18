import { hasGrant, type Principal } from '@shakti/contracts';
import type { ScreenPopSettings } from '../components/calls/screen-pop';
import { navRequires } from '../nav';
import { mintRingingTicket } from './ticket';
import { screenPopTransport } from './transport';

type Env = Readonly<Record<string, string | undefined>>;

const holds = (principal: Principal, navId: string) =>
  navRequires(navId).every((g) => hasGrant(principal.permissions, g.key, g.scope));

/**
 * The screen-pop's settings for the app shell (docs/03-roadmap-appendix/phase2.md §7.4): only a
 * person who places calls (`calls.dial`) is given one, with a fresh ticket for the ringing route,
 * the transport this deployment uses, the companies the switcher shows, and whether they may open
 * a customer's page and the New lead form, which the pop opens for them.
 */
export function screenPopSettings(
  principal: Principal,
  now: Date = new Date(),
  env: Env = process.env,
): ScreenPopSettings | undefined {
  if (principal.kind !== 'user' || !hasGrant(principal.permissions, 'calls.dial', 'own')) {
    return undefined;
  }
  const transport = screenPopTransport(env);
  return {
    ticket: mintRingingTicket(principal.id, now, env),
    realtime: transport.kind === 'realtime' ? { url: transport.url, key: transport.key } : null,
    viewCompanies: [...principal.entityIds],
    mayAddLead: holds(principal, 'leads-new'),
    mayOpenCustomers: holds(principal, 'customers'),
  };
}
