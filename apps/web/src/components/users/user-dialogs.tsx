'use client';

import type { UserDto } from '@shakti/contracts';
import {
  Button,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode, type SyntheticEvent } from 'react';
import {
  clearSignInLock,
  inviteUser,
  reactivateUser,
  resetTwoFactor,
  setUserRoles,
  suspendUser,
} from '../../actions/admin';
import { entityRolesFrom, roleChoicesOf, type RoleChoices } from '../../screens/user-roles';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';
import { RolesField } from './roles-field';

type Companies = readonly { id: number; name: string }[];

/** The buttons under a dialog's form: cancel, and the one action. */
function Footer({
  onCancel,
  pending,
  danger = false,
  children,
}: {
  onCancel: () => void;
  pending: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  const common = useTranslations('common');
  return (
    <DialogFooter>
      <Button variant="secondary" onClick={onCancel}>
        {common('cancel')}
      </Button>
      <Button type="submit" variant={danger ? 'danger' : 'primary'} pending={pending}>
        {children}
      </Button>
    </DialogFooter>
  );
}

const INVITE_FIELDS = ['displayName', 'email', 'entityRoles'] as const;

/** Invite: name, work email and a role per company; the action emails the set-password link. */
export function InviteForm({
  companies,
  roleKeys,
  onDone,
  onCancel,
}: {
  companies: Companies;
  roleKeys: readonly string[];
  onDone: (user: UserDto) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('users.inviteDialog');
  const { run, pending, failure } = useCommand(inviteUser);
  const { fieldError, formFailure } = useFieldFailure(failure, INVITE_FIELDS);
  const [choices, setChoices] = useState<RoleChoices>(() => roleChoicesOf([], companies));
  const [needsRole, setNeedsRole] = useState(false);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const entityRoles = entityRolesFrom(choices, companies);
    setNeedsRole(entityRoles.length === 0);
    if (entityRoles.length === 0) return;
    run(
      { displayName: formText(data, 'displayName'), email: formText(data, 'email'), entityRoles },
      onDone,
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('intro')}</DialogDescription>
      </DialogHeader>
      <Field id="invite-name" label={t('name')} error={fieldError('displayName')}>
        <Input name="displayName" required minLength={2} maxLength={120} autoComplete="off" />
      </Field>
      <Field id="invite-email" label={t('email')} error={fieldError('email')}>
        <Input
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <RolesField
        idPrefix="invite-role"
        companies={companies}
        roleKeys={roleKeys}
        choices={choices}
        onChange={setChoices}
        error={needsRole ? t('needsRole') : fieldError('entityRoles')}
      />
      <FailureMessage failure={formFailure} />
      <Footer onCancel={onCancel} pending={pending}>
        {t('submit')}
      </Footer>
    </form>
  );
}

/** Change roles: replaces every role of the person, which signs them out everywhere. */
export function RolesForm({
  user,
  companies,
  roleKeys,
  onDone,
  onCancel,
}: {
  user: UserDto;
  companies: Companies;
  roleKeys: readonly string[];
  onDone: (user: UserDto) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('users.rolesDialog');
  const invite = useTranslations('users.inviteDialog');
  const { run, pending, failure } = useCommand(setUserRoles);
  const { fieldError, formFailure } = useFieldFailure(failure, ['entityRoles']);
  const [choices, setChoices] = useState<RoleChoices>(() =>
    roleChoicesOf(user.entityRoles, companies),
  );
  const [needsRole, setNeedsRole] = useState(false);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const entityRoles = entityRolesFrom(choices, companies, user.entityRoles);
    setNeedsRole(entityRoles.length === 0);
    if (entityRoles.length === 0) return;
    run({ userId: user.id, entityRoles }, onDone);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{t('title', { name: user.displayName })}</DialogTitle>
        <DialogDescription>{t('intro')}</DialogDescription>
      </DialogHeader>
      <RolesField
        idPrefix="change-role"
        companies={companies}
        roleKeys={roleKeys}
        choices={choices}
        onChange={setChoices}
        error={needsRole ? invite('needsRole') : fieldError('entityRoles')}
      />
      <FailureMessage failure={formFailure} />
      <Footer onCancel={onCancel} pending={pending}>
        {t('submit')}
      </Footer>
    </form>
  );
}

/** Suspend: blocks sign-in and ends every sign-in; an optional reason goes to the activity log. */
export function SuspendForm({
  user,
  onDone,
  onCancel,
}: {
  user: UserDto;
  onDone: (user: UserDto) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('users.suspendDialog');
  const { run, pending, failure } = useCommand(suspendUser);
  const { fieldError, formFailure } = useFieldFailure(failure, ['reason']);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const reason = formText(new FormData(e.currentTarget), 'reason');
    run({ userId: user.id, ...(reason === '' ? {} : { reason }) }, onDone);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{t('title', { name: user.displayName })}</DialogTitle>
        <DialogDescription>{t('intro')}</DialogDescription>
      </DialogHeader>
      <Field
        id="suspend-reason"
        label={t('reason')}
        helper={t('reasonHelper')}
        error={fieldError('reason')}
      >
        <Input name="reason" maxLength={200} autoComplete="off" />
      </Field>
      <FailureMessage failure={formFailure} />
      <Footer onCancel={onCancel} pending={pending} danger>
        {t('submit')}
      </Footer>
    </form>
  );
}

/**
 * A confirmation with one action on one person: reactivate, reset the authenticator app or lift
 * the sign-in lock. The dialog says what happens before the button is pressed.
 */
function ConfirmForm<T>({
  user,
  action,
  title,
  intro,
  more,
  submit: label,
  danger = false,
  onDone,
  onCancel,
}: {
  user: UserDto;
  action: Parameters<typeof useCommand<T>>[0];
  title: string;
  intro: string;
  more?: string;
  submit: string;
  danger?: boolean;
  onDone: (data: T) => void;
  onCancel: () => void;
}) {
  const { run, pending, failure } = useCommand(action);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!pending) run({ userId: user.id }, onDone);
      }}
      className="flex flex-col gap-4"
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{intro}</DialogDescription>
      </DialogHeader>
      {more === undefined ? null : <p className="text-text-muted">{more}</p>}
      <FailureMessage failure={failure} />
      <Footer onCancel={onCancel} pending={pending} danger={danger}>
        {label}
      </Footer>
    </form>
  );
}

export function ReactivateForm(props: {
  user: UserDto;
  onDone: (user: UserDto) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('users.reactivateDialog');
  return (
    <ConfirmForm
      {...props}
      action={reactivateUser}
      title={t('title', { name: props.user.displayName })}
      intro={t('intro')}
      submit={t('submit')}
    />
  );
}

/**
 * Reset authenticator app (docs/07-security.md §2): the Executive is told to confirm who is asking,
 * by phone or in person, before pressing the button.
 */
export function ResetAuthenticatorForm(props: {
  user: UserDto;
  onDone: (user: UserDto) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('users.resetDialog');
  return (
    <ConfirmForm
      {...props}
      action={resetTwoFactor}
      title={t('title', { name: props.user.displayName })}
      intro={t('intro')}
      more={t('effect')}
      submit={t('submit')}
      danger
    />
  );
}

export function LiftLockForm(props: {
  user: UserDto;
  onDone: (nothing: null) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('users.liftLockDialog');
  return (
    <ConfirmForm
      {...props}
      action={clearSignInLock}
      title={t('title', { name: props.user.displayName })}
      intro={t('intro')}
      submit={t('submit')}
    />
  );
}
