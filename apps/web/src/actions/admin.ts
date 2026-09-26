'use server';

import {
  DomainError,
  InviteUserInput,
  ReactivateUserInput,
  RevokeSessionInput,
  SetUserRolesInput,
  SuspendUserInput,
  type RevokedSessionsDto,
  type UserDto,
} from '@shakti/contracts';
import { withRequestContext } from '@shakti/db';
import {
  inviteUser as inviteUserCommand,
  reactivateUser as reactivateUserCommand,
  revokeSession as revokeSessionCommand,
  runCommand,
  setUserRoles as setUserRolesCommand,
  suspendUser as suspendUserCommand,
} from '@shakti/domain';
import { auth } from '../auth/auth';
import { currentPrincipal, forgetPrincipal } from '../auth/current-principal';

/** Thin wrappers (docs/API.md §4): session → parse → request context → command → DTO. */

export async function inviteUser(rawInput: unknown): Promise<UserDto> {
  const principal = await currentPrincipal();
  if (!principal) throw new DomainError('unauthorized');
  const input = InviteUserInput.parse(rawInput);
  const user = await withRequestContext(principal, {}, (context) =>
    runCommand(inviteUserCommand, { context }, input),
  );
  // The set-password link goes out through the auth module's own flow (no headers: an internal call).
  await auth.api.requestPasswordReset({ body: { email: user.email, redirectTo: '/set-password' } });
  return user;
}

export async function setUserRoles(rawInput: unknown): Promise<UserDto> {
  const principal = await currentPrincipal();
  if (!principal) throw new DomainError('unauthorized');
  const input = SetUserRolesInput.parse(rawInput);
  const user = await withRequestContext(principal, {}, (context) =>
    runCommand(setUserRolesCommand, { context }, input),
  );
  await forgetPrincipal(user.id);
  return user;
}

export async function suspendUser(rawInput: unknown): Promise<UserDto> {
  const principal = await currentPrincipal();
  if (!principal) throw new DomainError('unauthorized');
  const input = SuspendUserInput.parse(rawInput);
  const user = await withRequestContext(principal, {}, (context) =>
    runCommand(suspendUserCommand, { context }, input),
  );
  await forgetPrincipal(user.id);
  return user;
}

export async function reactivateUser(rawInput: unknown): Promise<UserDto> {
  const principal = await currentPrincipal();
  if (!principal) throw new DomainError('unauthorized');
  const input = ReactivateUserInput.parse(rawInput);
  return withRequestContext(principal, {}, (context) =>
    runCommand(reactivateUserCommand, { context }, input),
  );
}

export async function revokeSession(rawInput: unknown): Promise<RevokedSessionsDto> {
  const principal = await currentPrincipal();
  if (!principal) throw new DomainError('unauthorized');
  const input = RevokeSessionInput.parse(rawInput);
  const result = await withRequestContext(principal, {}, (context) =>
    runCommand(revokeSessionCommand, { context }, input),
  );
  await forgetPrincipal(result.userId);
  return result;
}
