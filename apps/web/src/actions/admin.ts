'use server';

// The Team members, sessions and Activity log screens call these actions, except
// `replayDeadLetter`: its screen, the Integration Health page, comes in Phase 1
// (docs/03-roadmap-appendix/backend-weeks-3-5.md §4.4).

import {
  ClearSignInLockInput,
  type AuditPageDto,
  type AuditPeopleDto,
  DomainError,
  IntegrationReplayRequest,
  type IntegrationReplayResponse,
  InviteUserInput,
  ReactivateUserInput,
  ResetTwoFactorInput,
  type RoleGrantsDto,
  type RoleListDto,
  type RolePermissionsSetDto,
  RevokeSessionInput,
  SetRolePermissionsInput,
  SetUserRolesInput,
  SuspendUserInput,
  type RevokedSessionsDto,
  type SessionListDto,
  type UserDto,
  type UserPageDto,
} from '@shakti/contracts';
import {
  clearSignInLock as clearSignInLockCommand,
  executeCommand,
  executeQuery,
  getRoleGrants as getRoleGrantsQuery,
  inviteUser as inviteUserCommand,
  listAuditPeople as listAuditPeopleQuery,
  listRoles as listRolesQuery,
  listUserSessions as listUserSessionsQuery,
  listUsers as listUsersQuery,
  queryAudit,
  reactivateUser as reactivateUserCommand,
  replayDeadLetter as replayDeadLetterCommand,
  resetTwoFactor as resetTwoFactorCommand,
  revokeSession as revokeSessionCommand,
  setRolePermissions as setRolePermissionsCommand,
  setUserRoles as setUserRolesCommand,
  suspendUser as suspendUserCommand,
} from '@shakti/domain';
import { auth } from '../auth/auth';
import { clearSignInLock as clearLock, setPasswordMailFailed } from '../auth/create-auth';
import { currentSession, forgetPrincipal } from '../auth/current-principal';
import { defaultAuthDeps } from '../auth/deps';
import { twoFactorResetMail } from '../auth/mail-copy';
import { logger } from '../log';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

/**
 * Thin wrappers (docs/06-api.md §4): session → parse → request context → command → DTO. Each
 * answers an `ActionResult` instead of throwing, because Next.js masks thrown errors in production.
 */

export async function inviteUser(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<UserDto>> {
  return toResult('inviteUser', async () => {
    const principal = await signedIn();
    const input = parseInput(InviteUserInput, rawInput);
    const meta = await requestMeta();
    const user = await executeCommand(
      principal,
      { requestId: meta.requestId },
      inviteUserCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
    // The set-password link goes out through the auth module's own flow (no headers: an internal
    // call). Inviting someone still invited sends a fresh link, which withdraws the old one.
    await auth.api.requestPasswordReset({
      body: { email: user.email, redirectTo: '/set-password' },
    });
    if (await setPasswordMailFailed(defaultAuthDeps(), user.id)) {
      throw new DomainError('integration_unavailable', 'the invitation email did not go out', {
        reason: 'invite_mail_failed',
      });
    }
    return user;
  });
}

export async function setUserRoles(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<UserDto>> {
  return toResult('setUserRoles', async () => {
    const principal = await signedIn();
    const input = parseInput(SetUserRolesInput, rawInput);
    const meta = await requestMeta();
    const user = await executeCommand(
      principal,
      { requestId: meta.requestId },
      setUserRolesCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
    await forgetPrincipal(user.id);
    return user;
  });
}

/** What the role editor learns after a save; the holders' ids stay on the server. */
type RolePermissionsSaved = Omit<RolePermissionsSetDto, 'holderUserIds'>;

/**
 * Admin › Roles: replaces a staff role's grants (Executive, for every company). Everyone holding
 * the role is signed out by the command, except the caller's own current sign-in, which this
 * action names from the session itself, never from the browser; then every holder's cached
 * access is dropped, so the caller's next request, on the kept sign-in, resolves the new grants.
 * A cache that cannot be reached is logged; the committed save is still reported as saved.
 */
export async function setRolePermissions(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<RolePermissionsSaved>> {
  return toResult('setRolePermissions', async () => {
    const principal = await signedIn();
    const session = await currentSession();
    const raw = typeof rawInput === 'object' && rawInput !== null ? rawInput : {};
    const input = parseInput(SetRolePermissionsInput, {
      ...raw,
      keepSessionId: session?.session.sessionId,
    });
    const meta = await requestMeta();
    const { holderUserIds, ...saved } = await executeCommand(
      principal,
      { requestId: meta.requestId },
      setRolePermissionsCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
    // The save has committed and every holder is signed out; a cache that could not be told
    // lets a kept sign-in use the old grants for at most a minute, so it is logged, not failed.
    const forgotten = await Promise.allSettled(holderUserIds.map((id) => forgetPrincipal(id)));
    const missed = forgotten.filter((r) => r.status === 'rejected').length;
    if (missed > 0) {
      logger.log('warn', 'principal_cache.invalidate_failed', {
        requestId: meta.requestId,
        note: `${String(missed)} of ${String(holderUserIds.length)} holders not invalidated`,
      });
    }
    return saved;
  });
}

export async function suspendUser(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<UserDto>> {
  return toResult('suspendUser', async () => {
    const principal = await signedIn();
    const input = parseInput(SuspendUserInput, rawInput);
    const meta = await requestMeta();
    const user = await executeCommand(
      principal,
      { requestId: meta.requestId },
      suspendUserCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
    await forgetPrincipal(user.id);
    return user;
  });
}

export async function reactivateUser(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<UserDto>> {
  return toResult('reactivateUser', async () => {
    const principal = await signedIn();
    const input = parseInput(ReactivateUserInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      reactivateUserCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/**
 * Sends a failed message to other systems again (Executive only, design §4.4): the dead-lettered
 * event goes back in the queue with its attempts cleared, and the publisher's next run, at most a
 * minute away, sends it. No screen calls it yet: the Integration Health page and its replay
 * route come in Phase 1 (docs/03-roadmap-appendix/backend-weeks-3-5.md §4.4).
 */
export async function replayDeadLetter(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<IntegrationReplayResponse>> {
  return toResult('replayDeadLetter', async () => {
    const principal = await signedIn();
    const input = parseInput(IntegrationReplayRequest, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      replayDeadLetterCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

export async function revokeSession(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<RevokedSessionsDto>> {
  return toResult('revokeSession', async () => {
    const principal = await signedIn();
    const input = parseInput(RevokeSessionInput, rawInput);
    const meta = await requestMeta();
    const result = await executeCommand(
      principal,
      { requestId: meta.requestId },
      revokeSessionCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
    await forgetPrincipal(result.userId);
    return result;
  });
}

/** How long a form's key can replay its answer (`idempotency_keys` keeps a key seven days). */
const NOTICE_KEY_SECONDS = 7 * 24 * 60 * 60;

/**
 * True unless this caller's form key has already sent its notice: a replay answers the first
 * call's result, which still says an app was removed. Without a key there is no replay. When the
 * store cannot answer, the notice goes out: a second email is better than none.
 */
async function firstNotice(
  principalId: string,
  key: string | undefined,
  requestId: string,
): Promise<boolean> {
  if (key === undefined) return true;
  try {
    const sends = await defaultAuthDeps().keyValue.incr(
      `two-factor-reset-notice:${principalId}:${key}`,
      NOTICE_KEY_SECONDS,
    );
    return sends === 1;
  } catch (error) {
    logger.log('warn', 'mail.two_factor_reset_repeat_unknown', { requestId, error });
    return true;
  }
}

/**
 * Removes a lost authenticator app (Executive only). The user is told by email when an app was
 * actually removed, which the command decides in its own transaction; a failed email is logged
 * and leaves the reset in place, because the user is already signed out and the Executive has
 * spoken to them before resetting (docs/07-security.md §2). A form sent twice with one key replays
 * the first answer, so the email goes out once per key.
 */
export async function resetTwoFactor(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<UserDto>> {
  return toResult('resetTwoFactor', async () => {
    const principal = await signedIn();
    const input = parseInput(ResetTwoFactorInput, rawInput);
    const meta = await requestMeta();
    const options = commandOptions(meta, idempotencyKey);
    const { user, authenticatorRemoved } = await executeCommand(
      principal,
      { requestId: meta.requestId },
      resetTwoFactorCommand,
      input,
      options,
    );
    await forgetPrincipal(user.id);
    if (
      authenticatorRemoved &&
      (await firstNotice(principal.id, options.idempotencyKey, meta.requestId))
    ) {
      try {
        await defaultAuthDeps().mailer.send(
          twoFactorResetMail({ email: user.email, name: user.displayName }),
        );
      } catch (error) {
        logger.log('error', 'mail.two_factor_reset_failed', { requestId: meta.requestId, error });
      }
    }
    return user;
  });
}

/**
 * Lifts every sign-in lock on a staff member's account (Executive only, AUDIT M6). The command
 * checks the permission and the person and records it in the Activity log; the lock itself lives
 * in the shared store, so it is lifted after the commit, as the other actions send their emails.
 * A repeat with the same key answers the stored person and lifts the lock again, which is harmless.
 */
export async function clearSignInLock(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<null>> {
  return toResult('clearSignInLock', async () => {
    const principal = await signedIn();
    const input = parseInput(ClearSignInLockInput, rawInput);
    const meta = await requestMeta();
    const user = await executeCommand(
      principal,
      { requestId: meta.requestId },
      clearSignInLockCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
    await clearLock(defaultAuthDeps(), user.email);
    return null;
  });
}

/** Admin › Team members: staff with a role in the companies being viewed, a page at a time. */
export async function listUsers(rawInput: unknown): Promise<ActionResult<UserPageDto>> {
  return toResult('listUsers', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => listUsersQuery(context, rawInput), {
      name: 'listUsers',
    });
  });
}

/** Admin › Roles: every staff role with its grant count and the people holding it. */
export async function listRoles(): Promise<ActionResult<RoleListDto>> {
  return toResult('listRoles', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => listRolesQuery(context), {
      name: 'listRoles',
    });
  });
}

/** One role's page: the permission catalogue with the role's scope for each. */
export async function getRoleGrants(rawInput: unknown): Promise<ActionResult<RoleGrantsDto>> {
  return toResult('getRoleGrants', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { requestId },
      (context) => getRoleGrantsQuery(context, rawInput),
      { name: 'getRoleGrants' },
    );
  });
}

/** One person's sign-ins, so an Executive can end one. */
export async function listUserSessions(rawInput: unknown): Promise<ActionResult<SessionListDto>> {
  return toResult('listUserSessions', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { requestId },
      (context) => listUserSessionsQuery(context, rawInput),
      { name: 'listUserSessions' },
    );
  });
}

/**
 * The audit trail for Admin › Activity log (docs/03-roadmap-appendix/backend-weeks-3-5.md §3.4): `audit.read`
 * at entity scope or wider; the query checks the permission and the database decides the rows.
 */
export async function listAuditLog(rawInput: unknown): Promise<ActionResult<AuditPageDto>> {
  return toResult('listAuditLog', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => queryAudit(context, rawInput), {
      name: 'listAuditLog',
    });
  });
}

/** The people who acted in a window, for the Activity log's person filter (`audit.read`). */
export async function listAuditPeople(rawInput: unknown): Promise<ActionResult<AuditPeopleDto>> {
  return toResult('listAuditPeople', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { requestId },
      (context) => listAuditPeopleQuery(context, rawInput),
      { name: 'listAuditPeople' },
    );
  });
}
