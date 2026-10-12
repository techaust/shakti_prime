import type { ReactNode } from 'react';
import { ClientMessages } from '../../i18n/client-messages';

/** The public pages: sign-in, passwords and the code screen, with only the words they use (WEB-1). */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return <ClientMessages scope="public">{children}</ClientMessages>;
}
