'use client';

import { PASSWORD_MIN_LENGTH } from '@shakti/contracts';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { setPassword, type SetPasswordState } from '../../actions/auth';
import { Button, Field, FormError, TextInput } from '../form';

export function SetPasswordForm({ token }: { token: string }) {
  const t = useTranslations('auth.setPassword');
  const [state, action, pending] = useActionState<SetPasswordState, FormData>(setPassword, {});
  if (state.done === true) {
    return (
      <div className="flex flex-col gap-4">
        <p>{t('done')}</p>
        <Link href="/sign-in" className="text-accent-text underline">
          {t('goSignIn')}
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <Field label={t('password')} id="password">
        <TextInput
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          invalid={state.error !== undefined}
          required
        />
      </Field>
      <Field label={t('confirm')} id="confirm">
        <TextInput
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>
      <FormError errorKey={state.error} reference={state.reference} />
      <Button type="submit" pending={pending}>
        {t('submit')}
      </Button>
    </form>
  );
}
