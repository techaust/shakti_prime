'use client';

import type { PinLookupDto } from '@shakti/contracts';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { lookupPin } from '../../actions/pin-codes';
import { settle } from '../screens/settle';

const PIN = /^[1-9][0-9]{5}$/;

/**
 * What the PIN code master knows of the PIN being typed (PRD CRM-02), asked once it has six
 * digits: the tehsil and district the site will be given, and the post offices to offer for the
 * village. The site's own save fills the tehsil and district the form leaves empty, or marks a
 * PIN outside the master for a check (`customer_sites_pin_fill`). A lookup that fails says
 * nothing; the save still works.
 */
export function usePinLookup(initial = ''): {
  pin: string;
  setPin: (value: string) => void;
  found: PinLookupDto | undefined;
} {
  const [pin, setPin] = useState(initial.trim());
  const [found, setFound] = useState<PinLookupDto | undefined>();
  useEffect(() => {
    if (!PIN.test(pin)) return;
    let stale = false;
    void settle(() => lookupPin({ pin })).then((result) => {
      if (!stale && result.ok) setFound(result.data);
    });
    return () => {
      stale = true;
    };
  }, [pin]);
  // An answer for an earlier PIN is not shown.
  return { pin, setPin: (value) => setPin(value.trim()), found: found?.pin === pin ? found : undefined };
}

/** The sentence under the PIN field: where the PIN is, or that it waits for a check. */
export function PinHint({ found }: { found: PinLookupDto | undefined }) {
  const t = useTranslations('pinLookup');
  if (found === undefined) return null;
  if (!found.known) return <span className="text-warning">{t('unknown')}</span>;
  if (found.tehsil !== null && found.district !== null) {
    return <>{t('tehsilAndDistrict', { tehsil: found.tehsil, district: found.district })}</>;
  }
  if (found.district !== null) return <>{t('district', { district: found.district })}</>;
  return <>{t('known')}</>;
}

/** The PIN's post offices, offered as the village (a `<datalist>` the village field names). */
export function LocalityOptions({ id, found }: { id: string; found: PinLookupDto | undefined }) {
  return (
    <datalist id={id}>
      {(found?.localities ?? []).map((name) => (
        <option key={name} value={name} />
      ))}
    </datalist>
  );
}
