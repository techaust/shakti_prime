'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import {
  beginTwoFactor,
  verifyTwoFactor,
  type FormState,
  type TwoFactorState,
} from '../../actions/auth';
import { Button, Field, FormError, TextInput } from '../form';

/** Code entry, used both at sign-in and to confirm a fresh enrolment. */
export function VerifyCodeForm() {
  const t = useTranslations('auth.twoFactor');
  const [state, action, pending] = useActionState<FormState, FormData>(verifyTwoFactor, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label={t('codeLabel')} id="code">
        <TextInput
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          required
        />
      </Field>
      <FormError errorKey={state.error} />
      <Button type="submit" disabled={pending}>
        {t('verify')}
      </Button>
    </form>
  );
}

/** Enrolment: confirm the password, scan the QR, keep the backup codes, confirm one code. */
export function EnrolForm() {
  const t = useTranslations('auth.twoFactor');
  const [state, action, pending] = useActionState<TwoFactorState, FormData>(beginTwoFactor, {});
  if (state.qrDataUrl === undefined) {
    return (
      <form action={action} className="flex flex-col gap-4">
        <Field label={t('password')} id="password">
          <TextInput
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
        <FormError errorKey={state.error} />
        <Button type="submit" disabled={pending}>
          {t('start')}
        </Button>
      </form>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">{t('scanTitle')}</h2>
        <p className="text-text-muted">{t('scanIntro')}</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- a data URL generated per enrolment */}
        <img
          src={state.qrDataUrl}
          alt=""
          width={220}
          height={220}
          className="rounded-[var(--radius-md)] bg-white p-2 self-start"
        />
        <p className="text-sm">
          <span className="text-text-muted">{t('secretLabel')}: </span>
          <code className="font-mono tracking-wider">{state.manualKey}</code>
        </p>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">{t('backupTitle')}</h2>
        <p className="text-text-muted">{t('backupIntro')}</p>
        <ul className="grid grid-cols-2 gap-1 font-mono text-sm">
          {(state.backupCodes ?? []).map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
      </section>
      <VerifyCodeForm />
    </div>
  );
}
