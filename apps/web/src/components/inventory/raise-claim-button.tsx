'use client';

import type { CustomerSiteDto } from '@shakti/contracts';
import { Button } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { warrantyClaimHref } from '../../screens/warranty';

// The dialog loads on first use, so Account 360 and the serial's page ship only the button.
const RaiseClaimDialog = dynamic(() =>
  import('./warranty-dialogs').then((m) => m.RaiseClaimDialog),
);

/**
 * Raise a warranty claim (R3, docs/03-roadmap-appendix/phase3.md §7.5): on Account 360 for the
 * customer, on a serial's page for that serial. The new claim's sheet opens once it is raised.
 */
export function RaiseClaimButton({
  entityId,
  on,
}: {
  entityId: number;
  on:
    | { kind: 'customer'; accountId: string; sites: readonly CustomerSiteDto[] }
    | { kind: 'serial'; serialId: string; serialNo: string };
}) {
  const t = useTranslations('warranty');
  const router = useRouter();
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        ref={button}
        variant="secondary"
        onClick={() => {
          setOpen(true);
        }}
      >
        {t('raise')}
      </Button>
      {open ? (
        <RaiseClaimDialog
          entityId={entityId}
          on={on}
          returnFocusTo={() => [button.current]}
          onClose={() => {
            setOpen(false);
          }}
          onSaved={(claim) => {
            setOpen(false);
            router.push(warrantyClaimHref(claim.entityId, claim.id));
          }}
        />
      ) : null}
    </>
  );
}
