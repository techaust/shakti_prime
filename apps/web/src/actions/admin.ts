'use server';

import {
  ClearSignInLockInput,
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
  reactivateUser as reactivateUserCommand,
  revokeSession as revokeSessionCommand,
  setUserRoles as setUserRolesCommand,
  suspendUser as suspendUserCommand,
} from '@shakti/domain';
import { auth } from '../auth/auth';
import { clearSignInLock as clearLock, setPasswordMailFailed } from '../auth/create-auth';
import { currentPrincipal, forgetPrincipal } from '../auth/current-principal';
import { defaultAuthDeps } from '../auth/deps';
import { parseInput, requestId } from './support';

/** Thin wrappers (docs/API.md §4): session → parse → request context → command → DTO. */

export async function inviteUser(rawInput: unknown): Promise<UserDto> {
  const principal = await currentPrincipal();
  if (!principal) throw new DomainError('unauthorized');
  const input = parseInput(InviteUserInput, rawInput);
  const user = await executeCommand(
    principal,
    { requestId: await requestId() },
    inviteUserCommand,
    input,
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

export async function setUserRoles(rawInput: unknown): Promise<UserDto> {
  const principal = await currentPrincipal();
  if (!principal) throw new DomainError('unauthorized');
  const input = parseInput(SetUserRolesInput, rawInput);
  const user = await executeCommand(
    principal,
    { requestId: await requestId() },
    setUserRolesCommand,
    input,
  );
  await forgetPrincipal(user.id);
  return user;
}

export async function suspendUser(rawInput: unknown): Promise<UserDto> {
  const principal = await currentPrincipal();
  if (!principal) throw new DomainError('unauthorized');
  const input = parseInput(SuspendUserInput, rawInput);
  const user = await executeCommand(
    principal,
    { requestId: await requestId() },
    suspendUserCommand,
    input,
  );
  await forgetPrincipal(user.id);
  return user;
}

export async function reactivateUser(rawInput: unknown): Promise<UserDto> {
  const principal = await currentPrincipal();
  if (!principal) throw new DomainError('unauthorized');
  const input = parseInput(ReactivateUserInput, rawInput);
  return executeCommand(principal, { requestId: await requestId() }, reactivateUserCommand, input);
}

export async function revokeSession(rawInput: unknown): Promise<RevokedSessionsDto> {
  const principal = await currentPrincipal();
  if (!principal) throw new DomainError('unauthorized');
  const input = parseInput(RevokeSessionInput, rawInput);
  const result = await executeCommand(
    principal,
    { requestId: await requestId() },
    revokeSessionCommand,
    input,
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
  const user = await executeQuery(principal, { requestId: await requestId() }, ({ tx }) =>
    loadUserDto(tx, input.userId),
  );
  await clearLock(defaultAuthDeps(), user.email);
}
