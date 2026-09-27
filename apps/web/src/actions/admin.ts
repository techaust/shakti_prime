'use server';

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
  RevokeSessionInput,
  SetUserRolesInput,
  SuspendUserInput,
  type RevokedSessionsDto,
  type SessionListDto,
  type UserDto,
  type UserPageDto,
} from '@shakti/contracts';
import {
  checkPermission,
  executeCommand,
  executeQuery,
  inviteUser as inviteUserCommand,
  listAuditPeople as listAuditPeopleQuery,
  listUserSessions as listUserSessionsQuery,
  listUsers as listUsersQuery,
  loadUserDto,
  queryAudit,
  reactivateUser as reactivateUserCommand,
  replayDeadLetter as replayDeadLetterCommand,
  resetTwoFactor as resetTwoFactorCommand,
  revokeSession as revokeSessionCommand,
  setUserRoles as setUserRolesCommand,
  suspendUser as suspendUserCommand,
} from '@shakti/domain';
import { auth } from '../auth/auth';
import { clearSignInLock as clearLock, setPasswordMailFailed } from '../auth/create-auth';
import { forgetPrincipal } from '../auth/current-principal';
import { defaultAuthDeps } from '../auth/deps';
import { twoFactorResetMail } from '../auth/mail-copy';
import { logger } from '../log';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

/**
 * Thin wrappers (docs/API.md §4): session → parse → request context → command → DTO. Each
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
 * minute away, sends it.
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

/**
 * Removes a lost authenticator app (Executive only). The user is told by email when an app was
 * actually removed; a failed email is logged and leaves the reset in place, because the user is
 * already signed out and the Executive has spoken to them before resetting (docs/SECURITY.md §2).
 */
export async function resetTwoFactor(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<UserDto>> {
  return toResult('resetTwoFactor', async () => {
    const principal = await signedIn();
    const input = parseInput(ResetTwoFactorInput, rawInput);
    const meta = await requestMeta();
    const before = await executeQuery(principal, { requestId: meta.requestId }, ({ tx }) =>
      loadUserDto(tx, input.userId),
    );
    const user = await executeCommand(
      principal,
      { requestId: meta.requestId },
      resetTwoFactorCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
    await forgetPrincipal(user.id);
    if (before.twoFactorEnabled && !user.twoFactorEnabled) {
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

/** Lifts every sign-in lock on a staff member's account, for a user administrator only. */
export async function clearSignInLock(rawInput: unknown): Promise<ActionResult<null>> {
  return toResult('clearSignInLock', async () => {
    const principal = await signedIn();
    checkPermission(principal, 'admin.users.write', 'all');
    const input = parseInput(ClearSignInLockInput, rawInput);
    const user = await executeQuery(
      principal,
      { requestId: (await requestMeta()).requestId },
      ({ tx }) => loadUserDto(tx, input.userId),
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
    return executeQuery(principal, { requestId }, (context) => listUsersQuery(context, rawInput));
  });
}

/** One person's sign-ins, so an Executive can end one. */
export async function listUserSessions(rawInput: unknown): Promise<ActionResult<SessionListDto>> {
  return toResult('listUserSessions', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) =>
      listUserSessionsQuery(context, rawInput),
    );
  });
}

/**
 * The audit trail for Admin › Activity log (docs/design/backend-weeks-3-5.md §3.4): `audit.read`
 * at entity scope or wider; the query checks the permission and the database decides the rows.
 */
export async function listAuditLog(rawInput: unknown): Promise<ActionResult<AuditPageDto>> {
  return toResult('listAuditLog', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => queryAudit(context, rawInput));
  });
}

/** The people who acted in a window, for the Activity log's person filter (`audit.read`). */
export async function listAuditPeople(rawInput: unknown): Promise<ActionResult<AuditPeopleDto>> {
  return toResult('listAuditPeople', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) =>
      listAuditPeopleQuery(context, rawInput),
    );
  });
}
