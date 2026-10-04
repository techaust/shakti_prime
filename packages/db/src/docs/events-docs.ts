import { describeEventCatalogue, type EventCatalogueEntry } from '@shakti/contracts';

/**
 * Builds the event catalogue document (`docs/data/EVENTS.md`) from the event catalogue in
 * `packages/contracts/src/events/catalogue.ts`: every event type, whether a worker listens to it,
 * and its payload fields. Pure rendering: `pnpm db:docs` writes it, and a unit test fails when the
 * file is stale.
 *
 * The worker column comes from the catalogue alone. A type is `subscribed` exactly when
 * `EVENT_WORKERS` in `apps/web/src/workers/events/registry.ts` has a worker for it (checked by
 * `deliver.test.ts` in `apps/web`), and every worker is reached at the same route, so the document
 * needs nothing from the web app, which this package may not import.
 */

type JsonSchema = Record<string, unknown>;

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

const code = (text: string): string => `\`${text}\``;
const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function schemas(value: unknown): JsonSchema[] {
  return Array.isArray(value) ? value.filter((v): v is JsonSchema => typeof v === 'object') : [];
}

function range(min: unknown, max: unknown, unit: string): string {
  const low = typeof min === 'number' ? min : null;
  const high = typeof max === 'number' && Math.abs(max) < MAX_SAFE ? max : null;
  if (low !== null && high !== null) return `from ${String(low)} to ${String(high)}${unit}`;
  if (low !== null) return `from ${String(low)}${unit}`;
  if (high !== null) return `up to ${String(high)}${unit}`;
  return '';
}

/** A plain description of one JSON Schema node, as the payload tables print it. */
export function describeSchema(node: JsonSchema): string {
  const anyOf = schemas(node.anyOf);
  if (anyOf.length > 0) return anyOf.map(describeSchema).join(' or ');
  const allOf = schemas(node.allOf);
  if (allOf.length > 0) return allOf.map(describeSchema).join(' and ');
  const literal = (value: unknown): string =>
    typeof value === 'string' || typeof value === 'number' ? code(String(value)) : code('?');
  if (node.const !== undefined) return `always ${literal(node.const)}`;
  if (Array.isArray(node.enum)) return `one of ${node.enum.map(literal).join(', ')}`;
  switch (node.type) {
    case 'null':
      return 'null';
    case 'boolean':
      return 'true or false';
    case 'integer':
    case 'number': {
      const kind = node.type === 'integer' ? 'whole number' : 'number';
      const bounds = range(node.minimum, node.maximum, '');
      return bounds === '' ? kind : `${kind} ${bounds}`;
    }
    case 'string': {
      if (node.format === 'uuid') return 'id';
      if (node.format === 'date-time') return 'date and time (ISO 8601, UTC)';
      if (typeof node.pattern === 'string') return `text matching ${code(node.pattern)}`;
      const bounds = range(node.minLength, node.maxLength, ' characters');
      return bounds === '' ? 'text' : `text ${bounds}`;
    }
    case 'array': {
      const items =
        typeof node.items === 'object' && node.items !== null
          ? describeSchema(node.items as JsonSchema)
          : 'values';
      const least = typeof node.minItems === 'number' ? `, at least ${String(node.minItems)}` : '';
      return `list of ${items === 'id' ? 'ids' : items.replace(/^one of /, 'values from ')}${least}`;
    }
    case 'object': {
      const fields = Object.keys((node.properties as JsonSchema | undefined) ?? {});
      return fields.length > 0 ? `object with ${fields.map(code).join(', ')}` : 'object';
    }
    default:
      return 'any value';
  }
}

function fieldRows(schema: JsonSchema): string[] {
  const properties = (schema.properties as Record<string, JsonSchema> | undefined) ?? {};
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  return Object.entries(properties).map(
    ([name, node]) =>
      `| ${code(name)} | ${cell(describeSchema(node))}${required.has(name) ? '' : ' (optional)'} |`,
  );
}

const workerRoute = (type: string): string => `POST /api/v1/workers/outbox/${type}`;

function deliveryCell(entry: EventCatalogueEntry): string {
  return entry.subscribed
    ? `${code(workerRoute(entry.type))} (QStash URL group ${code(`evt-${entry.type}`)})`
    : 'none';
}

const anchor = (type: string): string => type.replace(/[^a-z0-9_]/g, '');

/** The module a type belongs to: the first part of its name. */
const MODULE_TITLES: Record<string, string> = {
  org: 'Organisation',
  crm: 'CRM',
  pricing: 'Pricing',
  catalogue: 'Catalogue',
  auth: 'Sign-in',
  admin: 'Administration',
  imports: 'Imports',
  platform: 'Platform',
  files: 'Files',
};

export function moduleOf(type: string): string {
  return type.split('.')[0] ?? type;
}

/** The types by module, modules in the order their first type appears in the catalogue. */
export function groupByModule(events: readonly EventCatalogueEntry[]): [string, EventCatalogueEntry[]][] {
  const groups = new Map<string, EventCatalogueEntry[]>();
  for (const entry of events) {
    const key = moduleOf(entry.type);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.entries()];
}

/** The whole of `docs/data/EVENTS.md`. */
export function renderEventsDoc(): string {
  const { version, envelope, events } = describeEventCatalogue();
  const subscribed = events.filter((e) => e.subscribed).length;
  const envelopeFields = (envelope.properties as Record<string, JsonSchema> | undefined) ?? {};
  const out: string[] = [
    '# Event catalogue — Shakti Prime BOS',
    '',
    `Every event type a command may emit, with its payload and the worker that receives it. Generated by \`pnpm db:docs\` from \`packages/contracts/src/events/catalogue.ts\`; \`packages/db/src/docs/events-docs.test.ts\` fails when this file and the catalogue differ, so it is regenerated, never edited.`,
    '',
    'How an event travels (the outbox row written in the command\'s transaction, the publisher, QStash, the worker and its failure callback) is in [ARCHITECTURE §6](../ARCHITECTURE.md#6-events-and-workers); the outbox table is in [DATABASE §6.10](../DATABASE.md#610-platform), and who may change its delivery columns in [§4.4](../DATABASE.md#outbox_events).',
    '',
    '## Contents',
    '',
    '- [Rules](#rules)',
    '- [Envelope](#envelope)',
    '- [Event types](#event-types)',
    ...groupByModule(events).map(
      ([key]) => `  - [${MODULE_TITLES[key] ?? key}](#${(MODULE_TITLES[key] ?? key).toLowerCase()})`,
    ),
    '- [Payloads](#payloads)',
    '',
    '## Rules',
    '',
    '- A type is named `<aggregate>.<verb_past>`. `ctx.emit()` refuses a type outside the catalogue and a payload that does not match its schema, which is strict: a field not listed below is refused.',
    '- A payload carries ids, codes, counts and times only, never a name, phone, email or free text, because it leaves the database for the queue; a worker reads anything else from the aggregate itself.',
    `- Every stored payload also carries \`v\`, the version of its shape (${String(version)} for every type).`,
    '- A type is subscribed exactly when a worker handles it (`EVENT_WORKERS` in `apps/web/src/workers/events/registry.ts`, checked by `deliver.test.ts`). The publisher marks an event of a type nobody handles as delivered without sending it, because QStash refuses a message to a URL group with no endpoint.',
    '',
    '## Envelope',
    '',
    'What the publisher sends a worker for one event (`DeliveredEvent`).',
    '',
    '| Field | Type |',
    '|---|---|',
    ...Object.entries(envelopeFields).map(([name, node]) =>
      name === 'payload'
        ? `| ${code(name)} | the event's payload, below, with ${code('v')} |`
        : name === 'type'
          ? `| ${code(name)} | one of the event types below |`
          : `| ${code(name)} | ${cell(describeSchema(node))} |`,
    ),
    '',
    '## Event types',
    '',
    `${String(events.length)} types, ${String(subscribed)} with a worker, grouped by the module that names them. *Emitted by* lists the commands that emit the type: \`emittedBy\` in the catalogue, which \`packages/domain/src/command/event-emitters.test.ts\` checks against the command sources (a command that runs another through \`ctx.run\` emits what that one emits).`,
    '',
  ];
  for (const [key, entries] of groupByModule(events)) {
    out.push(
      `### ${MODULE_TITLES[key] ?? key}`,
      '',
      '| Type | Meaning | Emitted by | Worker |',
      '|---|---|---|---|',
      ...entries.map(
        (e) =>
          `| [${code(e.type)}](#${anchor(e.type)}) | ${cell(e.meaning)} | ${e.emittedBy.map(code).join(', ')} | ${cell(deliveryCell(e))} |`,
      ),
      '',
    );
  }
  out.push('## Payloads', '');
  for (const entry of events) {
    out.push(`### ${entry.type}`, '');
    const rows = fieldRows(entry.payload);
    if (rows.length === 0) out.push('No fields apart from `v`.', '');
    else out.push('| Field | Type |', '|---|---|', ...rows, '');
  }
  return `${out.join('\n').trimEnd()}\n`;
}
