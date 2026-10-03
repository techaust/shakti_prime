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
  /** Further permissions the command needs, each at its own narrowest scope (AUDIT L9). */
  alsoRequires?: readonly { permission: PermissionKey; minScope: Scope }[];
  /**
   * Only people may call it: the guard refuses an agent, a voice session and the system principal
   * (`people_only`) before it checks the permission (SECURITY §3.3).
   */
  peopleOnly?: boolean;
  input: I;
  /** A strict DTO. Anything the handler returns beyond it is an error, never a leak. */
  output: O;
  /** Catalogue reasons for unique or check constraints the handler may race against. */
  constraintReasons?: Readonly<Record<string, string>>;
  /**
   * What the audit row records of the input, when the input itself is too large or carries
   * customer data in shapes the redaction cannot recognise (an import file's rows). Redacted
   * like any other input; left out, the whole parsed input is recorded.
   */
  auditInput?: (input: z.output<I>) => unknown;
  /**
   * Every top-level key the handler's `ctx.audit()` calls record in `before` or `after`, other
   * than ids (`id`, `…Id`, `…Ids`); `[]` when they record none. The Activity log gives each one
   * a name on screen (a test in `apps/web` checks the labels against these lists), and the runner
   * refuses an undeclared key outside production, so a list cannot fall behind its command.
   */
  auditFields: readonly string[];
  handler: (ctx: CommandContext, input: z.output<I>) => Promise<z.input<O>>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- registry of heterogeneous commands
export type AnyCommand = Command<z.ZodType<any>, z.ZodType<any>>;

export function defineCommand<I extends z.ZodType, O extends z.ZodType>(
  command: Command<I, O>,
): Command<I, O> {
  return command;
}
