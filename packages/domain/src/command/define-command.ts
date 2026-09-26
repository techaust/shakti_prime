import type { PermissionKey, Scope } from '@shakti/contracts';
import type { z } from 'zod';
import type { CommandContext } from './context';

export interface Command<I extends z.ZodType, O extends z.ZodType> {
  /** `module.resource.action`, the name UI, agents, voice and imports call. */
  name: string;
  /** Declared, never checked inline (AGENTS.md §5). */
  permission: PermissionKey;
  /** Narrowest scope that satisfies the guard. Row visibility is then decided by RLS. */
  minScope?: Scope;
  input: I;
  /** A strict DTO. Anything the handler returns beyond it is an error, never a leak. */
  output: O;
  handler: (ctx: CommandContext, input: z.output<I>) => Promise<z.input<O>>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- registry of heterogeneous commands
export type AnyCommand = Command<z.ZodType<any>, z.ZodType<any>>;

export function defineCommand<I extends z.ZodType, O extends z.ZodType>(
  command: Command<I, O>,
): Command<I, O> {
  return command;
}
