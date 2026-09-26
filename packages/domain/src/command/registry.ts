import { DomainError } from '@shakti/contracts';
import { updateEntity } from '../commands/org/update-entity';
import type { AnyCommand } from './define-command';

/** Every command the system can perform, by name. Agents, voice and imports call through here. */
export const commands = {
  [updateEntity.name]: updateEntity,
} as const satisfies Record<string, AnyCommand>;

export function getCommand(name: string): AnyCommand {
  const command = (commands as Record<string, AnyCommand | undefined>)[name];
  if (!command) throw new DomainError('not_found', `no command named ${name}`, { command: name });
  return command;
}
