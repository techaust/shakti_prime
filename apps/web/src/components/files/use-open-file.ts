'use client';

import { useState } from 'react';
import { openFile } from '../../actions/files';
import { settle } from '../screens/settle';
import type { CommandFailure } from '../screens/use-command';

/**
 * Opens a checked file in a new tab through a short-lived signed address (`openFile`). The tab is
 * opened at the click, while it still counts as the person's own, so no pop-up blocker stops it;
 * the address is filled in when it arrives, and the tab is closed again if it cannot be had.
 */
export function useOpenFile() {
  const [opening, setOpening] = useState(false);
  const [failure, setFailure] = useState<CommandFailure | undefined>();

  function open(fileId: string) {
    const tab = window.open('about:blank', '_blank');
    if (tab !== null) tab.opener = null;
    setOpening(true);
    void settle(() => openFile(fileId)).then((result) => {
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
