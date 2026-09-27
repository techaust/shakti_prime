'use server';

import {
  ClearSignInLockInput,
  type AuditPageDto,
  DomainError,
  InviteUserInput,
  ReactivateUserInput,
  RevokeSessionInput,
  SetUserRolesInput,
  SuspendUserInput,
  type RevokedSessionsDto,
  type UserDto,
} from '@shakti/contracts';
import {
  checkPermission,
  executeCommand,
  executeQuery,
  inviteUser as inviteUserCommand,
  loadUserDto,
  queryAudit,
  reactivateUser as reactivateUserCommand,
  revokeSession as revokeSessionCommand,
  setUserRoles as setUserRolesCommand,
  suspendUser as suspendUserCommand,
} from '@shakti/domain';
import { auth } from '../auth/auth';
import { clearSignInLock as clearLock, setPasswordMailFailed } from '../auth/create-auth';
import { currentPrincipal, forgetPrincipal } from '../auth/current-principal';
import { defaultAuthDeps } from '../auth/deps';
import { commandOptions, parseInput, requestMeta } from './support';

/** Thin wrappers (docs/API.md §4): session → parse → request context → command → DTO. */

export async function inviteUser(rawInput: unknown, idempotencyKey?: unknown): Promise<UserDto> {
  const principal = await currentPrincipal();
  if (!principal) throw new DomainError('unauthorized');
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
  await auth.api.requestPasswordReset({ body: { email: user.email, redirectTo: '/set-password' } });
  if (await setPasswordMailFailed(defaultAuthDeps(), user.id)) {
    throw new DomainError('integration_unavailable', 'the invitation email did not go out', {
      reason: 'invite_mail_failed',
    });
  }
  return user;
}

export async function setUserRoles(rawInput: unknown, idempotencyKey?: unknown): Promise<UserDto> {
  const principal = await currentPrincipal();
  if (!principal) throw new DomainError('unauthorized');
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
}

export async function suspendUser(rawInput: unknown, idempotencyKey?: unknown): Promise<UserDto> {
  const principal = await currentPrincipal();
  if (!principal) throw new DomainError('unauthorized');
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
}

export async function reactivateUser(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<UserDto> {
  const principal = await currentPrincipal();
  if (!principal) throw new DomainError('unauthorized');
  const input = parseInput(ReactivateUserInput, rawInput);
  const meta = await requestMeta();
  return executeCommand(
    principal,
    { requestId: meta.requestId },
    reactivateUserCommand,
    input,
    commandOptions(meta, idempotencyKey),
  );
}

export async function revokeSession(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<RevokedSessionsDto> {
  const principal = await currentPrincipal();
  if (!principal) throw new DomainError('unauthorized');
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
}

/** Lifts every sign-in lock on a staff member's account, for a user administrator only. */
export async function clearSignInLock(rawInput: unknown): Promise<void> {
  const principal = await currentPrincipal();
  if (!principal) throw new DomainError('unauthorized');
  checkPermission(principal, 'admin.users.write', 'all');
  const input = parseInput(ClearSignInLockInput, rawInput);
  const user = await executeQuery(
    principal,
    { requestId: (await requestMeta()).requestId },
    ({ tx }) => loadUserDto(tx, input.userId),
  );
  await clearLock(defaultAuthDeps(), user.email);
}

/**
 * The audit trail for Admin › Audit (docs/design/backend-weeks-3-5.md §3.4): `audit.read` at
 * entity scope or wider; the query checks the permission and the database decides the rows.
 */
export async function listAuditLog(rawInput: unknown): Promise<AuditPageDto> {
  const principal = await currentPrincipal();
  if (!principal) throw new DomainError('unauthorized');
  const { requestId } = await requestMeta();
  return executeQuery(principal, { requestId }, (context) => queryAudit(context, rawInput));
}
