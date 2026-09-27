'use client';

import { colors } from '@shakti/tokens';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import {
  beginTwoFactor,
  verifyBackupCode,
  verifyTwoFactor,
  type FormState,
  type TwoFactorState,
} from '../../actions/auth';
import { Button, Field, FormError, TextInput } from '../form';

/** Code entry, used both at sign-in and to confirm a fresh enrolment. */
export function VerifyCodeForm({ allowBackupCode = false }: { allowBackupCode?: boolean }) {
  const t = useTranslations('auth.twoFactor');
  const [state, action, pending] = useActionState<FormState, FormData>(verifyTwoFactor, {});
  const [useBackup, setUseBackup] = useState(false);
  if (useBackup) {
    return (
      <BackupCodeForm
        onBack={() => {
          setUseBackup(false);
        }}
      />
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label={t('codeLabel')} id="code">
        <TextInput
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          invalid={state.error !== undefined}
          required
        />
      </Field>
      <FormError errorKey={state.error} />
      <Button type="submit" pending={pending}>
        {t('verify')}
      </Button>
      {allowBackupCode ? (
        <Button
          type="button"
          variant="link"
          className="text-sm underline"
          onClick={() => {
            setUseBackup(true);
          }}
        >
          {t('useBackupCode')}
        </Button>
      ) : null}
    </form>
  );
}

/** One of the backup codes kept at enrolment; each works once. */
function BackupCodeForm({ onBack }: { onBack: () => void }) {
  const t = useTranslations('auth.twoFactor');
  const [state, action, pending] = useActionState<FormState, FormData>(verifyBackupCode, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label={t('backupCodeLabel')} id="code">
        <TextInput
          id="code"
          name="code"
          autoComplete="off"
          invalid={state.error !== undefined}
          required
        />
      </Field>
      <FormError errorKey={state.error} />
      <Button type="submit" pending={pending}>
        {t('verify')}
      </Button>
      <Button type="button" variant="link" className="text-sm underline" onClick={onBack}>
        {t('useAppCode')}
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
            invalid={state.error !== undefined}
            required
          />
        </Field>
        <FormError errorKey={state.error} />
        <Button type="submit" pending={pending}>
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
          alt={t('scanTitle')}
          width={220}
          height={220}
          // A QR code scans only on a light background, whatever the theme (DESIGN.md §7).
          style={{ backgroundColor: colors.surface.light }}
          className="self-start rounded-[var(--radius-md)] p-2"
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
