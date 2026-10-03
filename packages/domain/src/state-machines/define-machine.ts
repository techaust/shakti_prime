import {
  DomainError,
  PERMISSION_KEYS,
  type ErrorCode,
  type PermissionKey,
  type Principal,
  type Scope,
} from '@shakti/contracts';
import type { Requirement } from '../command/define-command';
import { checkPermission } from '../command/run-command';

/**
 * State machines as data (docs/design/backend-weeks-3-5.md §7.1). A machine lists its states and
 * transitions; `transition()` answers where an event takes a record and which effects the command
 * applies. It never writes: the command persists `state` and `state_changed_at`, applies the
 * effects, calls `ctx.audit()` and emits `<aggregate>.<event>`. The same data renders the
 * specification documents in `docs/state-machines/` (`pnpm --filter @shakti/domain machines:docs`).
 */

/** Who fires an event: a person or agent through a command, or the platform (a job or worker). */
export type Actor = { kind: 'principal'; principal: Principal } | { kind: 'system'; job: string };

export interface TransitionContext<P> {
  actor: Actor;
  now: Date;
  /** What the event carries: a reason, a target stage, an e-way bill number. */
  params: P;
  /**
   * For a transition whose permission the input names (`permissionByInput`): the permission and
   * scope the command resolved from its input, which the actor must hold. Without it such an
   * event is refused.
   */
  requirement?: Requirement;
}

/** Why a guard refused. `reason` maps to a sentence in the message catalogue. */
export interface GuardFailure {
  code: Extract<ErrorCode, 'validation_failed' | 'conflict' | 'forbidden'>;
  reason: string;
  details?: Record<string, unknown>;
}

/** A pure check on preloaded data; `description` is what the specification prints. */
export interface Guard<R, P> {
  description: string;
  // A method, so a machine of a narrower record still fits the registry's `AnyMachine`.
  check(record: R, ctx: TransitionContext<P>): GuardFailure | undefined;
}

/** Something the command does when the transition happens; the machine only names it. */
export interface Effect {
  key: string;
  description: string;
}

/** The record a machine reads: its state (null before it exists) and the facts its guards use. */
export interface MachineRecord<S extends string> {
  state: S | null;
}

export interface TransitionSpec<S extends string, E extends string, R, P> {
  /** The states the event may fire from, or `'new'` for the event that creates the record. */
  from: readonly S[] | 'new';
  event: E;
  to: S;
  /** The permission a person or agent needs, or null when only the platform fires the event. */
  permission: PermissionKey | null;
  /**
   * With `permission` null: the event is a person's, and the permission depends on the record's
   * kind (a file's purpose). The command's guard checks it by input (`PermissionByInput`) before
   * the transition runs; this names where the mapping lives, for the specification.
   */
  permissionByInput?: string;
  /** The narrowest scope that suffices; `own` when left out. */
  scope?: Scope;
  /** The platform (a scheduled job, a worker, the Tally connector) may also fire the event. */
  system?: boolean;
  /** A permission the catalogue does not have yet; `permission` holds the interim key. */
  newPermission?: string;
  guard?: Guard<R, P>;
  effects?: readonly Effect[];
  /** A line for the specification: what drives the event, or a rule enforced elsewhere. */
  note?: string;
  /** Not in the governing documents: chosen here and marked "proposed" for review. */
  proposed?: boolean;
}

export interface MachineSpec<S extends string, E extends string, R, P> {
  /** snake_case; the illegal-move reason is `<name>_transition_not_allowed`. */
  name: string;
  title: string;
  /** Which table and column hold the state, and what the machine governs. */
  summary: string;
  /** The documents the states and transitions come from. */
  sources: readonly string[];
  states: readonly S[];
  initial: S;
  /** States with no way out. */
  terminal: readonly S[];
  /** States the documents do not name, chosen here. */
  proposedStates?: readonly S[];
  stateNotes?: Partial<Record<S, string>>;
  transitions: readonly TransitionSpec<S, E, R, P>[];
}

export interface Machine<S extends string, E extends string, R, P> extends MachineSpec<S, E, R, P> {
  readonly events: readonly E[];
  readonly illegalReason: string;
}

// The erased form the registry, the renderer and the table-driven tests walk over.
export type AnyMachine = Machine<string, string, MachineRecord<string>, unknown>;

export interface TransitionResult<S extends string, E extends string> {
  from: S | null;
  to: S;
  event: E;
  effects: readonly Effect[];
}

const NAME = /^[a-z][a-z_]*$/;
const PERMISSIONS: ReadonlySet<string> = new Set(PERMISSION_KEYS);

function fail(name: string, problem: string): never {
  throw new Error(`state machine ${name}: ${problem}`);
}

/** Checks the definition once, at import, so a malformed machine never reaches a command. */
export function defineMachine<S extends string, E extends string, R extends MachineRecord<S>, P>(
  spec: MachineSpec<S, E, R, P>,
): Machine<S, E, R, P> {
  const { name, states, initial, terminal, transitions } = spec;
  if (!NAME.test(name)) fail(name, 'name must be snake_case');
  const known = new Set<string>(states);
  if (known.size !== states.length) fail(name, 'duplicate state');
  if (!known.has(initial)) fail(name, `initial state ${initial} is not a state`);
  for (const state of [...terminal, ...(spec.proposedStates ?? [])]) {
    if (!known.has(state)) fail(name, `${state} is not a state`);
  }

  const pairs = new Set<string>();
  const outgoing = new Set<string>();
  for (const t of transitions) {
    if (!known.has(t.to)) fail(name, `${t.event} goes to unknown state ${t.to}`);
    if (t.permission === null && t.system !== true && t.permissionByInput === undefined) {
      fail(name, `${t.event} has no permission and is not fired by the platform`);
    }
    if (t.permission !== null && !PERMISSIONS.has(t.permission)) {
      fail(name, `${t.event} names unknown permission ${t.permission}`);
    }
    if (t.newPermission !== undefined && PERMISSIONS.has(t.newPermission)) {
      fail(name, `${t.newPermission} already exists; it is not a new permission`);
    }
    if (t.from === 'new') {
      if (t.to !== initial) fail(name, `${t.event} creates the record outside ${initial}`);
      if (pairs.has(`new|${t.event}`)) fail(name, `duplicate creation event ${t.event}`);
      pairs.add(`new|${t.event}`);
      continue;
    }
    if (t.from.length === 0) fail(name, `${t.event} fires from no state`);
    for (const from of t.from) {
      if (!known.has(from)) fail(name, `${t.event} fires from unknown state ${from}`);
      if (terminal.includes(from)) fail(name, `${t.event} leaves terminal state ${from}`);
      const key = `${from}|${t.event}`;
      if (pairs.has(key)) fail(name, `two transitions for ${t.event} from ${from}`);
      pairs.add(key);
      if (from !== t.to) outgoing.add(from);
    }
  }
  for (const state of states) {
    if (!terminal.includes(state) && !outgoing.has(state)) {
      fail(name, `${state} is not terminal but has no way out`);
    }
  }

  // Every state is reachable from the initial one.
  const reached = new Set<string>([initial]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of transitions) {
      if (t.from !== 'new' && t.from.some((f) => reached.has(f)) && !reached.has(t.to)) {
        reached.add(t.to);
        grew = true;
      }
    }
  }
  for (const state of states) if (!reached.has(state)) fail(name, `${state} is unreachable`);

  const events = [...new Set(transitions.map((t) => t.event))];
  return { ...spec, events, illegalReason: `${name}_transition_not_allowed` };
}

/** The transition an event takes from a state, if the machine has one. */
export function findTransition<S extends string, E extends string, R, P>(
  machine: Machine<S, E, R, P>,
  state: S | null,
  event: E,
): TransitionSpec<S, E, R, P> | undefined {
  return machine.transitions.find(
    (t) =>
      t.event === event &&
      (t.from === 'new' ? state === null : state !== null && t.from.includes(state)),
  );
}

function authorise<S extends string, E extends string, R, P>(
  machine: Machine<S, E, R, P>,
  t: TransitionSpec<S, E, R, P>,
  actor: Actor,
  requirement: Requirement | undefined,
): void {
  if (actor.kind === 'system') {
    if (t.system === true) return;
    throw new DomainError('forbidden', `${machine.name}.${t.event} needs a person`, {
      event: t.event,
    });
  }
  if (t.permission === null) {
    if (t.permissionByInput !== undefined) {
      // The permission the command resolved from its input (`PermissionByInput`), checked again
      // here, so a caller that fires the event without resolving it is refused.
      if (requirement === undefined) {
        throw new DomainError('forbidden', `${machine.name}.${t.event} needs its permission`, {
          event: t.event,
        });
      }
      checkPermission(actor.principal, requirement.permission, requirement.minScope);
      return;
    }
    throw new DomainError('forbidden', `${machine.name}.${t.event} is fired by the platform`, {
      event: t.event,
    });
  }
  checkPermission(actor.principal, t.permission, t.scope ?? 'own');
}

/**
 * Fires `event` on `record`: `conflict` with `<machine>_transition_not_allowed` for a move the
 * machine does not have, `forbidden` when the actor may not fire it, the guard's own failure when
 * the facts refuse it; otherwise the target state and the effects for the command to apply.
 */
export function transition<S extends string, E extends string, R extends MachineRecord<S>, P>(
  machine: Machine<S, E, R, P>,
  record: R,
  event: E,
  ctx: TransitionContext<P>,
): TransitionResult<S, E> {
  const t = findTransition(machine, record.state, event);
  if (!t) {
    throw new DomainError(
      'conflict',
      `${machine.name}: no ${event} from ${record.state ?? 'new'}`,
      { reason: machine.illegalReason, state: record.state, event },
    );
  }
  authorise(machine, t, ctx.actor, ctx.requirement);
  const failure = t.guard?.check(record, ctx);
  if (failure) {
    throw new DomainError(failure.code, `${machine.name}.${event}: ${failure.reason}`, {
      ...failure.details,
      reason: failure.reason,
    });
  }
  return { from: record.state, to: t.to, event, effects: t.effects ?? [] };
}

/** Joins guards; the first refusal wins and the descriptions read as one list. */
export function allOf<R, P>(...guards: readonly Guard<R, P>[]): Guard<R, P> {
  return {
    description: guards.map((g) => g.description).join('; '),
    check: (record, ctx) => {
      for (const guard of guards) {
        const failure = guard.check(record, ctx);
        if (failure) return failure;
      }
      return undefined;
    },
  };
}

/** The guard shared by every event that must say why: a non-empty `reason` in the params. */
export function reasonGiven<R, P extends { reason?: string | null }>(
  description = 'a reason is given',
): Guard<R, P> {
  return {
    description,
    check: (_record, ctx) =>
      ctx.params.reason?.trim()
        ? undefined
        : { code: 'validation_failed', reason: 'transition_reason_missing' },
  };
}
