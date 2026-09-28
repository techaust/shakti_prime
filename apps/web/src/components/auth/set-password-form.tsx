'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useActionState } from 'react';
import { setPassword, type SetPasswordState } from '../../actions/auth';
import { PASSWORD_MIN_LENGTH } from '../../screens/contract-values';
import { blockWhilePending, Button, Field, FormError, TextInput, useFormFeedback } from '../form';

export function SetPasswordForm({ token }: { token: string }) {
  const t = useTranslations('auth.setPassword');
  const [state, action, pending] = useActionState<SetPasswordState, FormData>(setPassword, {});
  const { errorId, attempt, formRef } = useFormFeedback(state);
  const wrong = (name: string) =>
    state.error !== undefined && (state.field === undefined || state.field === name);
  if (state.done === true) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status">{t('done')}</p>
        <Link href="/sign-in" className="text-accent-text self-start underline">
          {t('goSignIn')}
        </Link>
      </div>
    );
  }
  return (
    <form
      ref={formRef}
      action={action}
      onSubmit={blockWhilePending(pending)}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="token" value={token} />
      <Field label={t('password')} id="password">
        <TextInput
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          invalid={wrong('password')}
          errorId={errorId}
          required
        />
      </Field>
      <Field label={t('confirm')} id="confirm">
        <TextInput
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          invalid={wrong('confirm')}
          errorId={errorId}
          required
        />
      </Field>
      <FormError
        id={errorId}
        attempt={attempt}
        errorKey={state.error}
        reference={state.reference}
      />
      <Button type="submit" pending={pending}>
        {t('submit')}
      </Button>
    </form>
  );
}
