import type { ReactNode } from 'react';
import { ClientMessages } from '../../../i18n/client-messages';

/** The words the HR screens' own parts use, added to the shell's (WEB-1, `CLIENT_SCOPES`). */
export default function HrLayout({ children }: { children: ReactNode }) {
  return <ClientMessages scope="/hr">{children}</ClientMessages>;
}
