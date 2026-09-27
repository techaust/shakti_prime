'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { signIn, type FormState } from '../../actions/auth';
import { TURNSTILE_SIGN_IN_ACTION } from '../../auth/turnstile';
import { blockWhilePending, Button, Field, FormError, TextInput, useFormFeedback } from '../form';
import { TurnstileWidget } from './turnstile-widget';

export function SignInForm({
  turnstileSiteKey,
  nonce,
}: {
  turnstileSiteKey: string;
  nonce: string;
}) {
  const t = useTranslations('auth.signIn');
  const [state, action, pending] = useActionState<FormState, FormData>(signIn, {});
  const { errorId, attempt, formRef } = useFormFeedback(state);
  // React clears a form after every submit; the email is kept so a mistyped password is the
  // only thing to type again (AUDIT M52).
  const [email, setEmail] = useState('');
  const invalid = state.error !== undefined;
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
          value={email}
          onChange={(e) => {
            setEmail(e.currentTarget.value);
          }}
          invalid={invalid}
          errorId={errorId}
          required
        />
      </Field>
      <Field label={t('password')} id="password">
        <TextInput
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          invalid={invalid}
          errorId={errorId}
          required
        />
      </Field>
      <TurnstileWidget
        siteKey={turnstileSiteKey}
        action={TURNSTILE_SIGN_IN_ACTION}
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
        {pending ? t('working') : t('submit')}
      </Button>
      <Link
        href="/forgot-password"
        className="text-accent-text inline-flex min-h-9 items-center self-start text-sm underline-offset-4 hover:underline max-md:min-h-11"
      >
        {t('forgot')}
      </Link>
    </form>
  );
}
