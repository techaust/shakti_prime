import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import type { ReactNode } from 'react';
import { PUBLIC_ERROR_KEYS } from '../auth/public-errors';
import { AddMessages } from './add-messages';
import { CLIENT_SCOPES, type ClientScope } from './client-namespaces';

/**
 * The message groups of one part of the app, for its client components (WEB-1, `CLIENT_SCOPES`).
 * The root layout's provider starts the set; every other scope adds its own groups to it. The
 * public pages get only the error sentences their forms can show.
 */
export async function ClientMessages({
  scope,
  children,
}: {
  scope: ClientScope;
  children: ReactNode;
}) {
  const namespaces: readonly string[] = CLIENT_SCOPES[scope];
  if (namespaces.length === 0) return children;
  const all = await getMessages();
  const picked = Object.fromEntries(namespaces.map((ns) => [ns, all[ns]]));
  if (scope === 'public') {
    const errors = all.errors as Record<string, string>;
    picked.errors = Object.fromEntries(PUBLIC_ERROR_KEYS.map((key) => [key, errors[key]]));
  }
  return scope === 'root' ? (
    <NextIntlClientProvider messages={picked}>{children}</NextIntlClientProvider>
  ) : (
    <AddMessages messages={picked}>{children}</AddMessages>
  );
}
