import { WORKSHOP_DEFAULTS } from '../workshop-defaults';
import type { AnyMachine } from './define-machine';
import { MACHINES } from './registry';

/**
 * Renders the machines into the specification documents in `docs/state-machines/` (BLUEPRINT §19
 * item 2). `pnpm --filter @shakti/domain machines:docs` writes them; `render.test.ts` fails when
 * the committed files differ from what the code would write.
 */

export const GENERATED_NOTE =
  '<!-- Generated from packages/domain/src/state-machines by `pnpm --filter @shakti/domain machines:docs`. Do not edit by hand. -->';

type AnyTransition = AnyMachine['transitions'][number];

function cell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function code(text: string): string {
  return `\`${text}\``;
}

function fileName(machine: AnyMachine): string {
  return `${machine.name.replaceAll('_', '-')}.md`;
}

function proposedMark(proposed: boolean | undefined): string {
  return proposed === true ? ' *(proposed)*' : '';
}

function fromText(t: AnyTransition): string {
  return t.from === 'new' ? '(new)' : t.from.map(code).join(', ');
}

function permissionText(t: AnyTransition): string {
  const parts: string[] = [];
  if (t.permission === null) {
    parts.push('the platform only');
  } else {
    const scope = t.scope && t.scope !== 'own' ? ` at ${t.scope} scope or wider` : '';
    parts.push(`${code(t.permission)}${scope}`);
    if (t.system === true) parts.push('or the platform');
  }
  if (t.newPermission !== undefined) {
    parts.push(`(interim; new permission needed: ${code(t.newPermission)})`);
  }
  return parts.join(' ');
}

function transitionRow(t: AnyTransition): string {
  const effects = (t.effects ?? []).map((e) => `${code(e.key)}: ${e.description}`).join('; ');
  return `| ${code(t.event)}${proposedMark(t.proposed)} | ${fromText(t)} → ${code(t.to)} | ${cell(permissionText(t))} | ${cell(t.guard?.description ?? '–')} | ${cell(effects || '–')} |`;
}

function stateRow(machine: AnyMachine, state: string): string {
  const tags: string[] = [];
  if (state === machine.initial) tags.push('initial');
  if (machine.terminal.includes(state)) tags.push('terminal');
  if (machine.proposedStates?.includes(state) === true) tags.push('*proposed*');
  const notes = machine.stateNotes?.[state];
  return `| ${code(state)} | ${tags.join(', ') || '–'} | ${cell(notes ?? '–')} |`;
}

function mermaid(machine: AnyMachine): string[] {
  const lines = ['```mermaid', 'stateDiagram-v2'];
  for (const t of machine.transitions) {
    if (t.from === 'new') {
      lines.push(`  [*] --> ${t.to} : ${t.event}`);
      continue;
    }
    for (const from of t.from) lines.push(`  ${from} --> ${t.to} : ${t.event}`);
  }
  for (const state of machine.terminal) lines.push(`  ${state} --> [*]`);
  lines.push('```');
  return lines;
}

function hasProposed(machine: AnyMachine): boolean {
  return (
    (machine.proposedStates?.length ?? 0) > 0 ||
    machine.transitions.some((t) => t.proposed === true)
  );
}

/** The specification document of one machine. */
export function renderMachine(machine: AnyMachine): string {
  const notes = machine.transitions.filter((t) => t.note !== undefined);
  const newPermissions = [
    ...new Set(machine.transitions.flatMap((t) => (t.newPermission ? [t.newPermission] : []))),
  ];
  const lines = [
    `# ${machine.title} state machine`,
    '',
    GENERATED_NOTE,
    '',
    machine.summary,
    '',
    `Sources: ${machine.sources.join('; ')}.`,
    '',
    hasProposed(machine)
      ? 'Items marked *proposed* are not named in the governing documents; they were chosen for this specification and need review.'
      : 'Every state and transition comes from the governing documents.',
    '',
    '## States',
    '',
    '| State | Kind | Notes |',
    '|---|---|---|',
    ...machine.states.map((s) => stateRow(machine, s)),
    '',
    '## Transitions',
    '',
    '| Event | From → To | Permitted actor | Guard | Effects |',
    '|---|---|---|---|---|',
    ...machine.transitions.map(transitionRow),
    '',
    `Any other event, or an event from a state not listed for it, answers \`conflict\` with reason \`${machine.illegalReason}\`. A guard that refuses answers its own reason; the permission check answers \`forbidden\`. The command persists \`state\` and \`state_changed_at\`, applies the effects, calls \`ctx.audit()\` and emits \`<aggregate>.<event>\`.`,
    '',
  ];
  if (notes.length > 0) {
    lines.push('## Notes', '', ...notes.map((t) => `- ${code(t.event)}: ${t.note ?? ''}`), '');
  }
  if (newPermissions.length > 0) {
    lines.push(
      '## New permissions needed',
      '',
      ...newPermissions.map(
        (p) =>
          `- ${code(p)}: not in the permission catalogue (SECURITY §3.2) yet; the transitions above use the interim key until it is added.`,
      ),
      '',
    );
  }
  lines.push('## Diagram', '', ...mermaid(machine), '');
  return lines.join('\n');
}

function flatten(value: unknown, prefix: string): [string, string][] {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, inner]) =>
      flatten(inner, prefix ? `${prefix}.${key}` : key),
    );
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return [[prefix, 'none']];
    // A list of records (the call outcomes) reads one record per line, field by field.
    const item = (v: unknown) =>
      typeof v === 'object' && v !== null
        ? Object.entries(v)
            .map(([key, inner]) => `${key}: ${String(inner)}`)
            .join('; ')
        : String(v);
    return [
      [prefix, value.map(item).join(value.some((v) => typeof v === 'object') ? '<br>' : ', ')],
    ];
  }
  return [[prefix, typeof value === 'bigint' ? value.toString() : String(value)]];
}

/** The index: every machine, the workshop defaults they use and the permissions they need. */
export function renderIndex(machines: readonly AnyMachine[]): string {
  const newPermissions = [
    ...new Set(
      machines.flatMap((m) =>
        m.transitions.flatMap((t) =>
          t.newPermission ? [`${code(t.newPermission)} (${m.name})`] : [],
        ),
      ),
    ),
  ];
  const lines = [
    '# State-machine specifications',
    '',
    GENERATED_NOTE,
    '',
    'The Phase 0 state-machine specifications (BLUEPRINT §19 item 2). Each machine is data in `packages/domain/src/state-machines/machines`; `transition()` in `define-machine.ts` checks the permission, runs the guard and returns the target state and effects, and answers `conflict` with `<machine>_transition_not_allowed` for any other move (docs/design/backend-weeks-3-5.md §7.1).',
    '',
    '| Machine | States | Events | Proposed items | Specification |',
    '|---|---|---|---|---|',
    ...machines.map((m) => {
      const proposed =
        (m.proposedStates?.length ?? 0) + m.transitions.filter((t) => t.proposed === true).length;
      return `| ${m.title} | ${String(m.states.length)} | ${String(m.events.length)} | ${String(proposed)} | [${fileName(m)}](${fileName(m)}) |`;
    }),
    '',
    '## Workshop defaults',
    '',
    'Values used until the discovery workshop answers (docs/design/backend-weeks-3-5.md §11); they live in `packages/domain/src/workshop-defaults.ts` and nowhere else.',
    '',
    '| Setting | Default |',
    '|---|---|',
    ...flatten(WORKSHOP_DEFAULTS, '').map(([key, value]) => `| ${code(key)} | ${cell(value)} |`),
    '',
  ];
  if (newPermissions.length > 0) {
    lines.push(
      '## New permissions needed',
      '',
      'Not in the permission catalogue yet; each transition names the interim key it uses.',
      '',
      ...newPermissions.map((p) => `- ${p}`),
      '',
    );
  }
  return lines.join('\n');
}

/** Every generated file by its name in `docs/state-machines/`. */
export function renderAll(machines: readonly AnyMachine[] = MACHINES): Map<string, string> {
  const files = new Map<string, string>([['README.md', renderIndex(machines)]]);
  for (const machine of machines) files.set(fileName(machine), renderMachine(machine));
  return files;
}
