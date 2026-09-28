'use client';

import type { UserDto, UserPageDto, UserSort, UserStatus } from '@shakti/contracts';
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
  useFocusTargets,
  type DataGridColumn,
  type FocusTargets,
  type StatusTone,
} from '@shakti/ui';
import { Ellipsis } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { listUsers } from '../../actions/admin';
import { USER_SORT_COLUMNS } from '../../screens/contract-values';
import { formatDateTime } from '../../screens/format';
import { userActions } from '../../screens/user-roles';
import { FailureMessage } from '../screens/failure';
import { sortInput, toListSort } from '../screens/list-sort';
import { useQuery } from '../screens/use-command';
import { useGridView } from '../screens/use-grid-view';
import { ViewsMenu } from '../screens/views-menu';
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

const PAGE_SIZE = 50;

/** The Invite button's key among the places focus returns to; user ids are UUIDs. */
const INVITE = 'invite';

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
  startInviting = false,
}: {
  initial: UserPageDto;
  selfId: string;
  companies: { id: number; name: string }[];
  companyNames: Record<number, string>;
  roleKeys: string[];
  /** Opens the invite dialog on arrival, for the palette's "Invite a person". */
  startInviting?: boolean;
}) {
  const t = useTranslations('users');
  const common = useTranslations('common');
  const roles = useTranslations('roles');
  const [rows, setRows] = useState(initial.items);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [open, setOpen] = useState<Open | undefined>(
    startInviting ? { kind: 'invite' } : undefined,
  );
  const { load, pending, failure } = useQuery<UserPageDto>();
  // The order the rows on screen were read in; an answer read in an older order is dropped.
  const sorted = useRef<UserSort | undefined>(undefined);
  const view = useGridView({
    density: 'comfortable',
    onSortChange: (next) => {
      const sort = toListSort(next, USER_SORT_COLUMNS);
      sorted.current = sort;
      setRows([]);
      setNextCursor(null);
      load(
        () => listUsers({ limit: PAGE_SIZE, ...sortInput(sort) }),
        (page) => {
          if (sorted.current !== sort) return;
          setRows(page.items);
          setNextCursor(page.nextCursor);
        },
      );
    },
  });

  const close = () => {
    setOpen(undefined);
  };
  // A row's dialogs and sheet open from its menu, whose item has gone when they close: focus
  // goes back to the row's Actions button, and for the invite dialog (or a row that has gone) to
  // the Invite button (DESIGN.md §6, Dialog).
  const places = useFocusTargets<string>();
  const returnFocusTo = () => [
    open === undefined || open.kind === 'invite' ? [] : places.get(open.user.id),
    places.get(INVITE),
  ];
  const replace = (user: UserDto) => {
    setRows((all) => all.map((u) => (u.id === user.id ? user : u)));
  };

  function loadMore() {
    if (nextCursor === null) return;
    const sort = sorted.current;
    load(
      () => listUsers({ limit: PAGE_SIZE, cursor: nextCursor, ...sortInput(sort) }),
      (page) => {
        if (sorted.current !== sort) return;
        setRows((all) => [...all, ...page.items.filter((u) => !all.some((x) => x.id === u.id))]);
        setNextCursor(page.nextCursor);
      },
    );
  }

  // Sorted on the server over the whole team (`USER_SORT_COLUMNS`); the status is not, because
  // its shown words come from the message catalogue.
  const columns: DataGridColumn<UserDto>[] = [
    {
      id: 'name',
      header: t('columns.name'),
      primary: true,
      cell: (u) => (u.id === selfId ? t('you', { name: u.displayName }) : u.displayName),
      sortable: true,
    },
    {
      id: 'email',
      header: t('columns.email'),
      cell: (u) => <span className="break-all">{u.email}</span>,
      sortable: true,
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
      sortable: true,
    },
    {
      id: 'lastSignIn',
      header: t('columns.lastSignIn'),
      numeric: true,
      cell: (u) => (u.lastLoginAt === null ? common('never') : formatDateTime(u.lastLoginAt)),
      sortable: true,
    },
    {
      id: 'actions',
      header: <span className="sr-only">{t('columns.actions')}</span>,
      align: 'end',
      cell: (u) => <RowMenu user={u} selfId={selfId} focusTargets={places} onOpen={setOpen} />,
    },
  ];

  const dialog = open === undefined || open.kind === 'sessions' ? undefined : open;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex justify-end">
        <Button
          ref={places.ref(INVITE)}
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
        loading={pending && rows.length === 0}
        {...view.grid}
        toolbar={
          <ViewsMenu
            screen="team_members"
            current={view.settings}
            standard={view.standard}
            onApply={view.apply}
          />
        }
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
          <DialogContent closeLabel={common('close')} returnFocusTo={returnFocusTo}>
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
          <SheetContent closeLabel={common('close')} returnFocusTo={returnFocusTo}>
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
  focusTargets,
  onOpen,
}: {
  user: UserDto;
  selfId: string;
  /** Files the Actions button, so focus comes back to it when the dialog closes. */
  focusTargets: FocusTargets<string>;
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
      <DropdownMenuTrigger asChild ref={focusTargets.ref(user.id)}>
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
