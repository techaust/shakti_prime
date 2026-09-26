'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { changePassword, signOut, switchEntity, type FormState } from '../../actions/auth';
import { Button, Field, FormError, TextInput } from '../form';

export function SignOutButton() {
  const t = useTranslations('auth.home');
  return (
    <form action={signOut}>
      <Button type="submit" variant="secondary">
        {t('signOut')}
      </Button>
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
        className="bg-surface border-border-strong h-9 rounded-[var(--radius-md)] border px-3"
      >
        <option value="">{t('allCompanies')}</option>
        {entities.map((e) => (
          <option key={e.entityId} value={String(e.entityId)}>
            {e.label}
          </option>
        ))}
      </select>
      <Button type="submit" variant="secondary">
        {t('switch')}
      </Button>
    </form>
  );
}

export function ChangePasswordForm() {
  const t = useTranslations('auth.changePassword');
  const [state, action, pending] = useActionState<FormState, FormData>(changePassword, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <h2 className="font-semibold">{t('title')}</h2>
      <Field label={t('current')} id="currentPassword">
        <TextInput
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <Field label={t('next')} id="newPassword">
        <TextInput
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={12}
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
      <FormError errorKey={state.error} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {t('submit')}
      </Button>
    </form>
  );
}
