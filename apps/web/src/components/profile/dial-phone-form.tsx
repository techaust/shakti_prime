'use client';

import { Button, Field, Input, toast } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { saveDialPhone } from '../../actions/dialling';
import { formatPhone } from '../../screens/format';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { useCommand } from '../screens/use-command';

export interface DialPhoneRow {
  entityId: number;
  company: string;
  phone: string | null;
}

/** One company's dial phone: the number, saved with its own button beside it. */
function DialPhoneField({ row, showCompany }: { row: DialPhoneRow; showCompany: boolean }) {
  const t = useTranslations('profile.dialPhone');
  const [value, setValue] = useState(row.phone === null ? '' : formatPhone(row.phone));
  const { run, pending, failure } = useCommand(saveDialPhone, `dial-phone-${String(row.entityId)}`);
  const { fieldError, formFailure } = useFieldFailure(failure, ['phone']);
  const id = `dial-phone-${String(row.entityId)}`;
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        run({ entityId: row.entityId, phone: value }, (saved) => {
          setValue(saved.dialPhone === null ? '' : formatPhone(saved.dialPhone));
          toast.success(saved.dialPhone === null ? t('cleared') : t('saved'));
        });
      }}
    >
      <Field
        id={id}
        label={showCompany ? t('labelIn', { company: row.company }) : t('label')}
        helper={t('helper')}
        error={fieldError('phone')}
        actions={
          <Button type="submit" variant="secondary" pending={pending}>
            {t('save')}
          </Button>
        }
      >
        <Input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={value}
          onChange={(event) => {
            setValue(event.currentTarget.value);
          }}
        />
      </Field>
      <FailureMessage failure={formFailure} />
    </form>
  );
}

/**
 * Profile › Your phone for calls (docs/03-roadmap-appendix/phase2.md §6.3): the phone a call from
 * the screen rings first, in each company the person calls for (`crm.caller_profile.set_dial_phone`).
 * Only the person's own number is ever set here; an empty box clears it.
 */
export function DialPhoneForm({ rows }: { rows: DialPhoneRow[] }) {
  const t = useTranslations('profile.dialPhone');
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-h3">{t('heading')}</h2>
      <p className="text-text-muted text-sm">{t('intro')}</p>
      {rows.map((row) => (
        <DialPhoneField key={row.entityId} row={row} showCompany={rows.length > 1} />
      ))}
    </div>
  );
}
