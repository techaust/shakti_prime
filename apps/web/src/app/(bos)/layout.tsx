import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { currentSession } from '../../auth/current-principal';

/**
 * The BOS route group: nobody reaches a screen without a usable session. Pages check again,
 * because a layout does not re-run on every client navigation. The app shell (sidebar, top bar,
 * entity switcher) is built in week 4.
 */
export default async function BosLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  if (!session) redirect('/sign-in');
  if (session.blocked !== undefined) redirect('/sign-in?reason=no_access');
  if (!session.principal) redirect('/two-factor');
  return children;
}
