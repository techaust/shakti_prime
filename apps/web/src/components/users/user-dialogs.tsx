'use client';

import type { CallerProfilePersonDto, ReassignAllDto, UserDto } from '@shakti/contracts';
import {
  Button,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode, type SyntheticEvent } from 'react';
import {
  clearSignInLock,
  inviteUser,
  reactivateUser,
  resetTwoFactor,
  setUserRoles,
  suspendUser,
} from '../../actions/admin';
import { listCallerProfiles, reassignAllLeads } from '../../actions/handover';
import { entityRolesFrom, roleChoicesOf, type RoleChoices } from '../../screens/user-roles';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand, useQuery } from '../screens/use-command';
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

/**
 * Move all leads (`crm.lead.reassign_all`): every open lead and every lead set aside of a leaving
 * person, in one company, to one named person or in turn to the Lead Converters who are present.
 * The people to choose from load when the dialog opens and again when the company changes.
 */
export function MoveLeadsForm({
  user,
  offered,
  onDone,
  onCancel,
}: {
  /** The leaving person. */
  user: { id: string; displayName: string };
  /** The companies to choose between: the ones the person works in. */
  offered: Companies;
  onDone: (result: ReassignAllDto) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('users.moveLeadsDialog');
  const [entityId, setEntityId] = useState(offered[0]?.id ?? 0);
  const [target, setTarget] = useState('');
  const [people, setPeople] = useState<CallerProfilePersonDto[] | undefined>(undefined);
  const { run, pending, failure } = useCommand(reassignAllLeads);
  const { load, pending: loading, failure: loadFailure } = useQuery<CallerProfilePersonDto[]>();
  const { formFailure } = useFieldFailure(failure, []);

  const fetchPeople = (id: number) => {
    setPeople(undefined);
    setTarget('');
    load(
      () => listCallerProfiles({ entityId: id }),
      (list) => {
        setPeople(list.filter((p) => p.userId !== user.id));
      },
    );
  };
  // Loaded once when the dialog opens.
  useEffect(() => {
    load(
      () => listCallerProfiles({ entityId }),
      (list) => {
        setPeople(list.filter((p) => p.userId !== user.id));
      },
    );
    // First load only; a change of company loads in its own handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || target === '') return;
    run({ entityId, fromUserId: user.id, toUserId: target === TURN ? null : target }, (result) => {
      onDone(result);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{t('title', { name: user.displayName })}</DialogTitle>
        <DialogDescription>{target === TURN ? t('introInTurn') : t('intro')}</DialogDescription>
      </DialogHeader>
      {offered.length > 1 ? (
        <Field id="move-leads-company" label={t('company')}>
          <Select
            value={String(entityId)}
            onChange={(e) => {
              const id = Number(e.currentTarget.value);
              setEntityId(id);
              fetchPeople(id);
            }}
          >
            {offered.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {people === undefined && loadFailure === undefined ? (
        <p className="text-text-muted text-sm" role="status">
          {t('loading')}
        </p>
      ) : people?.length === 0 ? (
        <p className="text-text-muted text-sm">{t('nobody')}</p>
      ) : (
        <Field id="move-leads-target" label={t('target')}>
          <Select
            value={target}
            disabled={loading}
            onChange={(e) => {
              setTarget(e.currentTarget.value);
            }}
          >
            <option value="">{t('choose')}</option>
            <option value={TURN}>{t('inTurn')}</option>
            {(people ?? []).map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <FailureMessage failure={loadFailure ?? formFailure} />
      <Footer onCancel={onCancel} pending={pending}>
        {t('submit')}
      </Footer>
    </form>
  );
}

/** What to tell a manager once the leads have moved: how many, and what is left behind. */
export function useMoveLeadsNotice(): (result: ReassignAllDto, name: string) => string {
  const t = useTranslations('users.moveLeadsDialog');
  return (result, name) => {
    const done = t('done', { count: result.moved, remaining: result.remaining, name });
    return result.teamOnly ? `${done} ${t('doneTeamOnly', { name })}` : done;
  };
}

/** The companies a leaving person works in; all of them when they work in none. */
export function moveLeadsCompanies(user: UserDto, companies: Companies): Companies {
  const own = companies.filter((c) => user.entityRoles.some((r) => r.entityId === c.id));
  return own.length === 0 ? companies : own;
}

/** The choice that shares the leads between the present converters instead of naming a person. */
const TURN = 'in-turn';
