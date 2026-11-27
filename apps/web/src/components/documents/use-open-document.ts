'use client';

import { useState } from 'react';
import { openDocument } from '../../actions/documents';
import { settle } from '../screens/settle';
import type { CommandFailure } from '../screens/use-command';

/**
 * Opens a document's masked copy in a new tab through a short-lived address (`openDocument`, which
 * records the opening of an identity or bank paper). As `useOpenFile`: the tab is opened at the
 * click, so no pop-up blocker stops it, and closed again if the address cannot be had.
 */
export function useOpenDocument() {
  const [opening, setOpening] = useState(false);
  const [failure, setFailure] = useState<CommandFailure | undefined>();

  function open(entityId: number, documentId: string) {
    const tab = window.open('about:blank', '_blank');
    if (tab !== null) tab.opener = null;
    setOpening(true);
    void settle(() => openDocument({ entityId, documentId })).then((result) => {
      setOpening(false);
      if (result.ok) {
        setFailure(undefined);
        if (tab === null) window.location.assign(result.data.url);
        else tab.location.href = result.data.url;
        return;
      }
      tab?.close();
      setFailure((previous) => ({
        error: result.error,
        reference: result.reference,
        attempt: (previous?.attempt ?? 0) + 1,
      }));
    });
  }

  return { open, opening, failure };
}
