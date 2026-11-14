import { WHATSAPP_BODY_MAX } from '@shakti/contracts';
import { findIdentityNumbers } from '../privacy/identity-numbers';
import { findPersonalNumbers } from '../privacy/number-shapes';

/** Why the output filter holds a message back. */
export type OutputFilterReason = 'too_long' | 'link' | 'identity_number' | 'phone';

export interface OutputFilterRules {
  /** The hosts a message may link to (the companies' own sites); none allows no link at all. */
  linkHosts: readonly string[];
  /** The numbers a message may name: the company's own, in E.164. */
  companyNumbers: readonly string[];
}

/** A link: a scheme, `www.`, or a host name with a known top-level part, with what follows it. */
const LINK =
  /\b(?:(?:https?:\/\/|www\.)[^\s<>"']+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|in|net|org|co|io|info|biz|me|app|link|ly|gl|xyz|online|site|shop|store)(?:\/[^\s<>"']*)?)/gi;

/** The host a link names, lower case, without `www.`. */
function hostOf(link: string): string {
  const bare = link.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  return (bare.split(/[/?#:]/)[0] ?? '').toLowerCase();
}

function allowedHost(host: string, hosts: readonly string[]): boolean {
  return hosts.some((h) => {
    const allowed = h.toLowerCase().replace(/^www\./, '');
    return host === allowed || host.endsWith(`.${allowed}`);
  });
}

/** The last ten digits of a number, which is how two writings of one Indian number compare. */
const lastTen = (digits: string): string => digits.replace(/\D/g, '').slice(-10);

/**
 * The deterministic output filter of an outbound WhatsApp message (BLUEPRINT §9.4, design phase2
 * §6.1), run by the messaging worker on every text and template value before it sends: the
 * message is refused when it is longer than Meta takes, links anywhere but the companies' own
 * sites, carries an identity or bank account number (even one already masked would show the
 * person's last digits on a channel the BOS does not control), or names a phone number other than
 * the company's own. Answers the first rule broken.
 */
export function filterOutbound(
  texts: readonly string[],
  rules: OutputFilterRules,
): { ok: true } | { ok: false; reason: OutputFilterReason } {
  const own = new Set(rules.companyNumbers.map(lastTen));
  for (const text of texts) {
    if (text.length > WHATSAPP_BODY_MAX) return { ok: false, reason: 'too_long' };
    for (const match of text.matchAll(LINK)) {
      if (!allowedHost(hostOf(match[0]), rules.linkHosts)) return { ok: false, reason: 'link' };
    }
    if (findIdentityNumbers(text).length > 0 || /X{4,}[\s-]?X{0,4}[\s-]?\d{4}/.test(text)) {
      return { ok: false, reason: 'identity_number' };
    }
    for (const found of findPersonalNumbers(text)) {
      if (found.kind === 'aadhaar' && !found.alsoPhone) return { ok: false, reason: 'identity_number' };
      if (!own.has(lastTen(found.digits))) return { ok: false, reason: 'phone' };
    }
  }
  return { ok: true };
}
