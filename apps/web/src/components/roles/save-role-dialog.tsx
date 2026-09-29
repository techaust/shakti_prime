'use client';

import type { PermissionKey, Scope } from '@shakti/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type ReturnFocusTo,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import type { ReactNode, SyntheticEvent } from 'react';
import { setRolePermissions } from '../../actions/admin';
import { FailureMessage } from '../screens/failure';
import { useCommand } from '../screens/use-command';

type Saved = Extract<Awaited<ReturnType<typeof setRolePermissions>>, { ok: true }>['data'];

/**
 * Admin › Roles: the confirmation before a role's permissions are saved, loaded on demand by the
 * role editor. It says what changes and how many people are signed out; one idempotency key per
 * opening, so a double press saves once.
 */
export function SaveRoleDialog({
  roleKey,
  roleName,
  grants,
  summary,
  holderCount,
  holdsRole,
  returnFocusTo,
  onSaved,
  onClose,
}: {
  roleKey: string;
  roleName: string;
  grants: { permission: PermissionKey; scope: Scope }[];
  summary: ReactNode;
  holderCount: number;
  holdsRole: boolean;
  /** Where focus goes when the dialog closes: the Save button. */
  returnFocusTo: ReturnFocusTo;
  onSaved: (saved: Saved) => void;
  onClose: () => void;
}) {
  const t = useTranslations('adminRoles');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(setRolePermissions);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    run({ roleKey, grants }, onSaved);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={common('close')} returnFocusTo={returnFocusTo}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('confirm.title', { role: roleName })}</DialogTitle>
            <DialogDescription>{summary}</DialogDescription>
          </DialogHeader>
          <p>{t('confirm.signOut', { count: holderCount })}</p>
          {holdsRole ? <p className="text-text-muted">{t('confirm.you')}</p> : null}
          <FailureMessage failure={failure} />
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              {common('cancel')}
            </Button>
            <Button type="submit" pending={pending}>
              {t('confirm.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
