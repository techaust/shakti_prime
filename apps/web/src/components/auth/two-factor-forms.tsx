'use client';

import { colors } from '@shakti/tokens';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useActionState, useState } from 'react';
import {
  beginTwoFactor,
  verifyBackupCode,
  verifyTwoFactor,
  type FormState,
  type TwoFactorState,
} from '../../actions/auth';
import { blockWhilePending, Button, Field, FormError, TextInput, useFormFeedback } from '../form';

const backLink =
  'text-accent-text inline-flex min-h-9 items-center self-start text-sm underline-offset-4 hover:underline max-md:min-h-11';

/** Code entry, used both at sign-in and to confirm a fresh enrolment. */
export function VerifyCodeForm({ atSignIn = false }: { atSignIn?: boolean }) {
  const t = useTranslations('auth.twoFactor');
  const [state, action, pending] = useActionState<FormState, FormData>(verifyTwoFactor, {});
  const { errorId, attempt, formRef } = useFormFeedback(state);
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
    <form
      ref={formRef}
      action={action}
      onSubmit={blockWhilePending(pending)}
      className="flex flex-col gap-4"
    >
      <Field label={t('codeLabel')} id="code">
        <TextInput
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          invalid={state.error !== undefined}
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
        {t('verify')}
      </Button>
      {atSignIn ? (
        <>
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
          <Link href="/sign-in" className={backLink}>
            {t('backToSignIn')}
          </Link>
        </>
      ) : null}
    </form>
  );
}

/** One of the backup codes kept at enrolment; each works once. */
function BackupCodeForm({ onBack }: { onBack: () => void }) {
  const t = useTranslations('auth.twoFactor');
  const [state, action, pending] = useActionState<FormState, FormData>(verifyBackupCode, {});
  const { errorId, attempt, formRef } = useFormFeedback(state);
  return (
    <form
      ref={formRef}
      action={action}
      onSubmit={blockWhilePending(pending)}
      className="flex flex-col gap-4"
    >
      <Field label={t('backupCodeLabel')} id="code">
        {/* Phones must not capitalise or correct a code (AUDIT M51). */}
        <TextInput
          id="code"
          name="code"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          invalid={state.error !== undefined}
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
        {t('verify')}
      </Button>
      <Button type="button" variant="link" className="text-sm underline" onClick={onBack}>
        {t('useAppCode')}
      </Button>
    </form>
  );
}

/** Copies text, and says so for a moment. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const t = useTranslations('auth.twoFactor');
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => {
            setCopied(false);
          }, 2000);
        });
      }}
    >
      {copied ? t('copied') : label}
    </Button>
  );
}

/** Enrolment: confirm the password, scan the QR, keep the backup codes, confirm one code. */
export function EnrolForm() {
  const t = useTranslations('auth.twoFactor');
  const [state, action, pending] = useActionState<TwoFactorState, FormData>(beginTwoFactor, {});
  const { errorId, attempt, formRef } = useFormFeedback(state);
  if (state.qrDataUrl === undefined) {
    return (
      <form
        ref={formRef}
        action={action}
        onSubmit={blockWhilePending(pending)}
        className="flex flex-col gap-4"
      >
        <Field label={t('password')} id="password">
          <TextInput
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            invalid={state.error !== undefined}
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
          {t('start')}
        </Button>
      </form>
    );
  }
  const key = state.manualKey ?? '';
  const codes = state.backupCodes ?? [];
  const codesText = codes.join('\n');
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
          className="self-start rounded-md p-2"
        />
        <p className="text-text-muted text-sm">{t('secretLabel')}</p>
        {/* In groups of four, so it wraps and can be typed without losing the place (AUDIT L37). */}
        <p className="font-mono text-sm tracking-wider break-words">
          {(key.match(/.{1,4}/g) ?? []).join(' ')}
        </p>
        <CopyButton text={key} label={t('copyKey')} />
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">{t('backupTitle')}</h2>
        <p className="text-text-muted">{t('backupIntro')}</p>
        <ul className="grid grid-cols-2 gap-1 font-mono text-sm">
          {codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <CopyButton text={codesText} label={t('copyCodes')} />
          <a
            href={`data:text/plain;charset=utf-8,${encodeURIComponent(`${codesText}\n`)}`}
            download={t('codesFile')}
            className="bg-surface text-text border-border-strong hover:bg-surface-3 inline-flex h-9 items-center rounded-md border px-4 font-medium max-md:h-11"
          >
            {t('downloadCodes')}
          </a>
        </div>
      </section>
      <VerifyCodeForm />
    </div>
  );
}
