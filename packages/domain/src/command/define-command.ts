import type { PermissionKey, Scope } from '@shakti/contracts';
import type { z } from 'zod';
import type { CommandContext } from './context';

/** A permission at the narrowest scope that satisfies it. */
export interface Requirement {
  permission: PermissionKey;
  minScope: Scope;
}

/**
 * The permission of a command that serves several kinds of record, named by its input: one upload
 * command for every file purpose, each purpose with its own permission (`files/purposes.ts`).
 * Still a declaration: the guard reads it before the handler runs.
 */
export interface PermissionByInput<I> {
  /** Every permission the input can name, for the agent refusal sweep. */
  keys: readonly PermissionKey[];
  /** What this input needs; null when no request may send it, which the guard refuses. */
  of: (input: I) => Requirement | null;
}

export interface Command<I extends z.ZodType, O extends z.ZodType> {
  /** `module.resource.action`, the name UI, agents, voice and imports call. */
  name: string;
  /** Declared, never checked inline (AGENTS.md §5); by input for a command of several kinds. */
  permission: PermissionKey | PermissionByInput<z.output<I>>;
  /**
   * Narrowest scope that satisfies the guard (a permission by input names its own). Row
   * visibility is then decided by RLS.
   */
  minScope?: Scope;
  /** Further permissions the command needs, each at its own narrowest scope (AUDIT L9). */
  alsoRequires?: readonly Requirement[];
  /**
   * Only people may run it: the guard refuses an agent, a voice session and the system principal
   * (`people_only`) before it checks the permission, whatever they hold (docs/07-security.md §3.3),
   * such as a customer note, a tag of the company or a sizing (ADR 0021).
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
