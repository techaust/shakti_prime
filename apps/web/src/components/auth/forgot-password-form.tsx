'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useActionState } from 'react';
import { requestNewPassword, type SetPasswordState } from '../../actions/auth';
import { TURNSTILE_RESET_ACTION } from '../../auth/turnstile';
import { Button, Field, FormError, TextInput } from '../form';
import { TurnstileWidget } from './turnstile-widget';

/** Asks for a set-password link by email (AUDIT M26). The answer never says whether it exists. */
export function ForgotPasswordForm({ turnstileSiteKey }: { turnstileSiteKey: string }) {
  const t = useTranslations('auth.forgotPassword');
  const [state, action, pending] = useActionState<SetPasswordState, FormData>(
    requestNewPassword,
    {},
  );
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
    <form action={action} className="flex flex-col gap-4">
      <Field label={t('email')} id="email">
        <TextInput
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          invalid={state.error !== undefined}
          required
        />
      </Field>
      <TurnstileWidget siteKey={turnstileSiteKey} action={TURNSTILE_RESET_ACTION} attempt={state} />
      <FormError errorKey={state.error} reference={state.reference} />
      <Button type="submit" pending={pending}>
        {t('submit')}
      </Button>
    </form>
  );
}
