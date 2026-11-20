'use client';

import { Button } from '@shakti/ui';

/** Opens the browser's print dialog for the page; never printed itself. */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button
      type="button"
      variant="secondary"
      className="print:hidden"
      onClick={() => {
        window.print();
      }}
    >
      {label}
    </Button>
  );
}
