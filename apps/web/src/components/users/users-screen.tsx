'use client';

import type { UserDto, UserPageDto, UserStatus } from '@shakti/contracts';
import {
  Button,
  DataGrid,
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Sheet,
  SheetContent,
  StatusBadge,
  toast,
  type DataGridColumn,
  type StatusTone,
} from '@shakti/ui';
import { Ellipsis } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { listUsers } from '../../actions/admin';
import { formatDateTime } from '../../screens/format';
import { userActions } from '../../screens/user-roles';
import { FailureMessage } from '../screens/failure';
import { useQuery } from '../screens/use-command';
import { SessionsSheet } from './sessions-sheet';
import {
  InviteForm,
  LiftLockForm,
  ReactivateForm,
  ResetAuthenticatorForm,
  RolesForm,
  SuspendForm,
} from './user-dialogs';

const STATUS_TONE: Record<UserStatus, StatusTone> = {
  invited: 'info',
  active: 'success',
  suspended: 'warning',
  offboarded: 'neutral',
};

type Open =
  | { kind: 'invite' }
  | {
      kind: 'roles' | 'suspend' | 'reactivate' | 'reset' | 'liftLock' | 'sessions';
      user: UserDto;
    };

/**
 * Admin › Team members: the team as a grid with Load more, each row's actions in a menu, and one
 * dialog or sheet at a time. A change answers the person's new state, which replaces their row.
 */
export function UsersScreen({
  initial,
  selfId,
  companies,
  companyNames,
  roleKeys,
}: {
  initial: UserPageDto;
  selfId: string;
  companies: { id: number; name: string }[];
  companyNames: Record<number, string>;
  roleKeys: string[];
}) {
  const t = useTranslations('users');
  const common = useTranslations('common');
  const roles = useTranslations('roles');
  const [rows, setRows] = useState(initial.items);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [open, setOpen] = useState<Open | undefined>();
  const { load, pending, failure } = useQuery<UserPageDto>();

  const close = () => {
    setOpen(undefined);
  };
  const replace = (user: UserDto) => {
    setRows((all) => all.map((u) => (u.id === user.id ? user : u)));
  };

  function loadMore() {
    if (nextCursor === null) return;
    load(
      () => listUsers({ limit: 50, cursor: nextCursor }),
      (page) => {
        setRows((all) => [...all, ...page.items.filter((u) => !all.some((x) => x.id === u.id))]);
        setNextCursor(page.nextCursor);
      },
    );
  }

  const columns: DataGridColumn<UserDto>[] = [
    {
      id: 'name',
      header: t('columns.name'),
      primary: true,
      cell: (u) => (u.id === selfId ? t('you', { name: u.displayName }) : u.displayName),
    },
    {
      id: 'email',
      header: t('columns.email'),
      cell: (u) => <span className="break-all">{u.email}</span>,
    },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (u) => (
        <StatusBadge tone={STATUS_TONE[u.status]}>{t(`status.${u.status}`)}</StatusBadge>
      ),
    },
    {
      id: 'roles',
      header: t('columns.roles'),
      cell: (u) =>
        u.entityRoles.length === 0 ? (
          <span className="text-text-muted">{t('rolesField.none')}</span>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {u.entityRoles.map((r) => (
              <li key={r.entityId}>
                {t('roleIn', {
                  company: companyNames[r.entityId] ?? '',
                  role: roles(r.roleKey),
                })}
              </li>
            ))}
          </ul>
        ),
    },
    {
      id: 'authenticator',
      header: t('columns.authenticator'),
      cell: (u) => (u.twoFactorEnabled ? t('authenticatorOn') : t('authenticatorOff')),
    },
    {
      id: 'lastSignIn',
      header: t('columns.lastSignIn'),
      numeric: true,
      cell: (u) => (u.lastLoginAt === null ? common('never') : formatDateTime(u.lastLoginAt)),
    },
    {
      id: 'actions',
      header: <span className="sr-only">{t('columns.actions')}</span>,
      align: 'end',
      cell: (u) => <RowMenu user={u} selfId={selfId} onOpen={setOpen} />,
    },
  ];

  const dialog = open === undefined || open.kind === 'sessions' ? undefined : open;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex justify-end">
        <Button
          onClick={() => {
            setOpen({ kind: 'invite' });
          }}
        >
          {t('invite')}
        </Button>
      </div>
      <FailureMessage failure={failure} />
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={rows}
        rowKey={(u) => u.id}
        empty={
          <EmptyState
            message={t('empty')}
            action={
              <Button
                onClick={() => {
                  setOpen({ kind: 'invite' });
                }}
              >
                {t('invite')}
              </Button>
            }
          />
        }
        loadMore={
          nextCursor === null
            ? undefined
            : { label: common('loadMore'), onLoadMore: loadMore, pending }
        }
      />

      <Dialog
        open={dialog !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen) close();
        }}
      >
        {dialog === undefined ? null : (
          <DialogContent closeLabel={common('close')}>
            {dialog.kind === 'invite' ? (
              <InviteForm
                companies={companies}
                roleKeys={roleKeys}
                onCancel={close}
                onDone={(user) => {
                  setRows((all) => [user, ...all.filter((u) => u.id !== user.id)]);
                  close();
                  toast.success(t('inviteDialog.done', { email: user.email }));
                }}
              />
            ) : dialog.kind === 'roles' ? (
              <RolesForm
                user={dialog.user}
                companies={companies}
                roleKeys={roleKeys}
                onCancel={close}
                onDone={(user) => {
                  replace(user);
                  close();
                  toast.success(t('rolesDialog.done', { name: user.displayName }));
                }}
              />
            ) : dialog.kind === 'suspend' ? (
              <SuspendForm
                user={dialog.user}
                onCancel={close}
                onDone={(user) => {
                  replace(user);
                  close();
                  toast.success(t('suspendDialog.done', { name: user.displayName }));
                }}
              />
            ) : dialog.kind === 'reactivate' ? (
              <ReactivateForm
                user={dialog.user}
                onCancel={close}
                onDone={(user) => {
                  replace(user);
                  close();
                  toast.success(t('reactivateDialog.done', { name: user.displayName }));
                }}
              />
            ) : dialog.kind === 'reset' ? (
              <ResetAuthenticatorForm
                user={dialog.user}
                onCancel={close}
                onDone={(user) => {
                  replace(user);
                  close();
                  toast.success(t('resetDialog.done', { name: user.displayName }));
                }}
              />
            ) : (
              <LiftLockForm
                user={dialog.user}
                onCancel={close}
                onDone={() => {
                  close();
                  toast.success(t('liftLockDialog.done', { name: dialog.user.displayName }));
                }}
              />
            )}
          </DialogContent>
        )}
      </Dialog>

      <Sheet
        open={open?.kind === 'sessions'}
        onOpenChange={(isOpen) => {
          if (!isOpen) close();
        }}
      >
        {open?.kind === 'sessions' ? (
          <SheetContent closeLabel={common('close')}>
            <SessionsSheet user={open.user} />
          </SheetContent>
        ) : null}
      </Sheet>
    </div>
  );
}

/** A row's actions: only those that apply to this person and never to one's own access. */
function RowMenu({
  user,
  selfId,
  onOpen,
}: {
  user: UserDto;
  selfId: string;
  onOpen: (open: Open) => void;
}) {
  const t = useTranslations('users.menu');
  const common = useTranslations('common');
  const can = userActions(user, selfId);
  const item = (kind: Exclude<Open['kind'], 'invite'>, label: string) => (
    <DropdownMenuItem
      onSelect={() => {
        onOpen({ kind, user });
      }}
    >
      {label}
    </DropdownMenuItem>
  );
  return (
    // Not modal, so the dialog it opens takes focus cleanly when the menu closes.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={common('rowActions', { name: user.displayName })}
        >
          <Ellipsis aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {can.changeRoles ? item('roles', t('changeRoles')) : null}
        {item('sessions', t('sessions'))}
        {can.liftLock ? item('liftLock', t('liftLock')) : null}
        {can.resetAuthenticator || can.suspend || can.reactivate ? <DropdownMenuSeparator /> : null}
        {can.resetAuthenticator ? item('reset', t('resetAuthenticator')) : null}
        {can.reactivate ? item('reactivate', t('reactivate')) : null}
        {can.suspend ? item('suspend', t('suspend')) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
