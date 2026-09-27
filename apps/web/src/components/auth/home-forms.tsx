'use client';

import { PASSWORD_MIN_LENGTH } from '@shakti/contracts';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { changePassword, signOut, switchEntity, type SetPasswordState } from '../../actions/auth';
import {
  blockWhilePending,
  Button,
  Field,
  FormError,
  SubmitButton,
  TextInput,
  useFormFeedback,
} from '../form';
import { useForgetThemeOnThisDevice } from '../theme';

export function SignOutButton() {
  const t = useTranslations('auth.home');
  const forgetTheme = useForgetThemeOnThisDevice();
  return (
    <form action={signOut} onSubmit={forgetTheme}>
      {/* Sign out and Switch show that they are working, like every other button (AUDIT L38). */}
      <SubmitButton variant="secondary">{t('signOut')}</SubmitButton>
    </form>
  );
}

export function EntitySwitcher({
  entities,
  active,
}: {
  entities: { entityId: number; label: string }[];
  active: number | undefined;
}) {
  const t = useTranslations('auth.home');
  return (
    <form action={switchEntity} className="flex flex-col gap-2">
      <label htmlFor="entityId" className="text-text-muted text-sm">
        {t('companies')}
      </label>
      <select
        id="entityId"
        name="entityId"
        defaultValue={active === undefined ? '' : String(active)}
        className="bg-surface border-border-strong h-9 rounded-[var(--radius-md)] border px-3 max-md:h-11"
      >
        <option value="">{t('allCompanies')}</option>
        {entities.map((e) => (
          <option key={e.entityId} value={String(e.entityId)}>
            {e.label}
          </option>
        ))}
      </select>
      <SubmitButton variant="secondary">{t('switch')}</SubmitButton>
    </form>
  );
}

export function ChangePasswordForm() {
  const t = useTranslations('auth.changePassword');
  const [state, action, pending] = useActionState<SetPasswordState, FormData>(changePassword, {});
  const { errorId, attempt, formRef } = useFormFeedback(state);
  const wrong = (name: string) =>
    state.error !== undefined && (state.field === undefined || state.field === name);
  if (state.done === true) {
    return (
      <p role="status" className="text-text-muted">
        {t('done')}
      </p>
    );
  }
  return (
    <form
      ref={formRef}
      action={action}
      onSubmit={blockWhilePending(pending)}
      className="flex flex-col gap-4"
    >
      <h2 className="font-[590]">{t('title')}</h2>
      <Field label={t('current')} id="currentPassword">
        <TextInput
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          invalid={wrong('currentPassword')}
          errorId={errorId}
          required
        />
      </Field>
      <Field label={t('next')} id="newPassword">
        <TextInput
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          invalid={wrong('newPassword')}
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
      <Button type="submit" variant="secondary" pending={pending}>
        {t('submit')}
      </Button>
    </form>
  );
}
