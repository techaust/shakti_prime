'use client';

import { Button } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';

/** A4 at 96 px to the inch. */
const A4 = { width: 794, height: 1123 };

/**
 * The count's sheet as the print template draws it, in a frame of its own (no script runs in it,
 * and the page's theme never reaches it: printed documents are always light), with a button that
 * prints the frame alone.
 */
export function CountSheetFrame({ html }: { html: string }) {
  const t = useTranslations('inventory.counts.printSheet');
  const frame = useRef<HTMLIFrameElement>(null);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button
          onClick={() => {
            frame.current?.contentWindow?.print();
          }}
        >
          {t('print')}
        </Button>
      </div>
      <div className="border-border-strong overflow-auto rounded-sm border">
        <iframe
          ref={frame}
          title={t('frame')}
          srcDoc={html}
          // Same origin so the button can print it; no script, form or popup runs inside.
          sandbox="allow-same-origin allow-modals"
          className="border-0"
          style={{ width: A4.width, height: A4.height }}
        />
      </div>
    </div>
  );
}
