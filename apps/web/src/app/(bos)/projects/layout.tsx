import type { ReactNode } from 'react';
import { ClientMessages } from '../../../i18n/client-messages';

/** The words the project screens' own parts use, added to the shell's (WEB-1, `CLIENT_SCOPES`). */
export default function ProjectsLayout({ children }: { children: ReactNode }) {
  return <ClientMessages scope="/projects">{children}</ClientMessages>;
}
