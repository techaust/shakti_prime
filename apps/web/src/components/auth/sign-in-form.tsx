'use client';

import Script from 'next/script';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { signIn, type FormState } from '../../actions/auth';
import { Button, Field, FormError, TextInput } from '../form';

export function SignInForm({ turnstileSiteKey }: { turnstileSiteKey: string }) {
  const t = useTranslations('auth.signIn');
  const [state, action, pending] = useActionState<FormState, FormData>(signIn, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label={t('email')} id="email">
        <TextInput id="email" name="email" type="email" autoComplete="username" required />
      </Field>
      <Field label={t('password')} id="password">
        <TextInput
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
      />
      <div className="cf-turnstile" data-sitekey={turnstileSiteKey} />
      <FormError errorKey={state.error} />
      <Button type="submit" disabled={pending}>
        {pending ? t('working') : t('submit')}
      </Button>
    </form>
  );
}
