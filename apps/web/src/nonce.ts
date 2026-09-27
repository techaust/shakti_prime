import { headers } from 'next/headers';

/**
 * The per-request nonce `proxy.ts` puts in the Content-Security-Policy (AUDIT L43). A script a
 * page loads itself (the bot-check widget) carries it; Next.js adds it to its own scripts.
 */
export async function requestNonce(): Promise<string> {
  return (await headers()).get('x-nonce') ?? '';
}
