'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useActionState } from 'react';
import { requestNewPassword, type SetPasswordState } from '../../actions/auth';
import { TURNSTILE_RESET_ACTION } from '../../auth/turnstile';
import { blockWhilePending, Button, Field, FormError, TextInput, useFormFeedback } from '../form';
import { TurnstileWidget } from './turnstile-widget';

/** Asks for a set-password link by email (AUDIT M26). The answer never says whether it exists. */
export function ForgotPasswordForm({
  turnstileSiteKey,
  nonce,
}: {
  turnstileSiteKey: string;
  nonce: string;
}) {
  const t = useTranslations('auth.forgotPassword');
  const [state, action, pending] = useActionState<SetPasswordState, FormData>(
    requestNewPassword,
    {},
  );
  const { errorId, attempt, formRef } = useFormFeedback(state);
  if (state.done === true) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status">{t('done')}</p>
        <Link
          href="/sign-in"
          className="text-accent-text inline-flex min-h-9 items-center self-start underline-offset-4 hover:underline max-md:min-h-11"
        >
          {t('back')}
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
      <Field label={t('email')} id="email">
        <TextInput
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          defaultValue={state.email}
          invalid={state.error !== undefined}
          errorId={errorId}
          required
        />
      </Field>
      <TurnstileWidget
        siteKey={turnstileSiteKey}
        action={TURNSTILE_RESET_ACTION}
        attempt={state}
        nonce={nonce}
      />
      <FormError
        id={errorId}
        attempt={attempt}
        errorKey={state.error}
        reference={state.reference}
      />
      <Button type="submit" pending={pending}>
        {t('submit')}
      </Button>
      <Link
        href="/sign-in"
        className="text-accent-text inline-flex min-h-9 items-center self-start text-sm underline-offset-4 hover:underline max-md:min-h-11"
      >
        {t('back')}
      </Link>
    </form>
  );
}
