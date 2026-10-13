import type { ReactNode } from 'react';
import { ClientMessages } from '../../../i18n/client-messages';

/** The words this screen's own parts use, added to the shell's (WEB-1, `CLIENT_SCOPES`). */
export default function CatalogueLayout({ children }: { children: ReactNode }) {
  return <ClientMessages scope="/catalogue">{children}</ClientMessages>;
}
