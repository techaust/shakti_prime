import { DomainError } from '@shakti/contracts';
import { inviteUser } from '../commands/admin/invite-user';
import { revokeSession } from '../commands/admin/revoke-session';
import { setUserRoles } from '../commands/admin/set-user-roles';
import { reactivateUser, suspendUser } from '../commands/admin/user-status';
import { createLead } from '../commands/crm/create-lead';
import { updateEntity } from '../commands/org/update-entity';
import { setPrice } from '../commands/pricing/set-price';
import type { AnyCommand } from './define-command';

/** Every command the system can perform, by name. Agents, voice and imports call through here. */
export const commands = {
  [updateEntity.name]: updateEntity,
  [createLead.name]: createLead,
  [setPrice.name]: setPrice,
  [inviteUser.name]: inviteUser,
  [setUserRoles.name]: setUserRoles,
  [suspendUser.name]: suspendUser,
  [reactivateUser.name]: reactivateUser,
  [revokeSession.name]: revokeSession,
} as const satisfies Record<string, AnyCommand>;

export function getCommand(name: string): AnyCommand {
  const command = (commands as Record<string, AnyCommand | undefined>)[name];
  if (!command) throw new DomainError('not_found', `no command named ${name}`, { command: name });
  return command;
}
