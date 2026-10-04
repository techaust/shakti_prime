import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Builds the ERD (`docs/data/ERD.md`) and the data dictionary (`docs/data/DATA-DICTIONARY.md`)
 * from the latest Drizzle snapshot, the hand-written SQL in the migrations (policies, triggers,
 * exclusion constraints, partitioning) and the table catalogue in docs/DATABASE.md §6. Pure
 * rendering: `pnpm db:docs` writes the result, and a unit test fails when the files are stale.
 */

// --- Inputs -----------------------------------------------------------------------------------

interface SnapshotColumn {
  name: string;
  type: string;
  primaryKey: boolean;
  notNull: boolean;
  default?: unknown;
  identity?: unknown;
}

interface SnapshotIndex {
  name: string;
  columns: { expression: string; isExpression: boolean; asc: boolean; opclass?: string }[];
  isUnique: boolean;
  method: string;
  where?: string;
}

interface SnapshotForeignKey {
  name: string;
  tableFrom: string;
  columnsFrom: string[];
  tableTo: string;
  columnsTo: string[];
  onDelete?: string;
  onUpdate?: string;
}

interface SnapshotTable {
  name: string;
  columns: Record<string, SnapshotColumn>;
  indexes: Record<string, SnapshotIndex>;
  foreignKeys: Record<string, SnapshotForeignKey>;
  compositePrimaryKeys: Record<string, { name: string; columns: string[] }>;
  uniqueConstraints: Record<string, { name: string; columns: string[] }>;
  checkConstraints: Record<string, { name: string; value: string }>;
}

export interface Snapshot {
  tables: Record<string, SnapshotTable>;
}

export interface MigrationFile {
  name: string;
  sql: string;
}

export interface DataDocSources {
  snapshotFile: string;
  snapshot: Snapshot;
  migrations: MigrationFile[];
  databaseDoc: string;
}

/** The first migration that creates `table`, by its four-digit number, or null. */
export function createdIn(migrations: readonly MigrationFile[], table: string): string | null {
  const create = new RegExp(`create table (if not exists )?("?public"?\\.)?"?${table}"?\\s*\\(`, 'i');
  const found = migrations.find((m) => create.test(m.sql));
  return found === undefined ? null : found.name.slice(0, 4);
}

/** Reads the inputs from a checkout: the newest snapshot, every migration, DATABASE.md. */
export function readSources(repoRoot: string): DataDocSources {
  const folder = join(repoRoot, 'packages', 'db', 'migrations');
  const snapshots = readdirSync(join(folder, 'meta'))
    .filter((f) => /^\d{4}_snapshot\.json$/.test(f))
    .sort();
  const snapshotFile = snapshots.at(-1);
  if (snapshotFile === undefined) throw new Error('no Drizzle snapshot under migrations/meta');
  const snapshot = JSON.parse(readFileSync(join(folder, 'meta', snapshotFile), 'utf8')) as Snapshot;
  const migrations = readdirSync(folder)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(folder, name), 'utf8') }));
  const databaseDoc = readFileSync(join(repoRoot, 'docs', 'DATABASE.md'), 'utf8');
  return { snapshotFile, snapshot, migrations, databaseDoc };
}

// --- DATABASE.md §6 --------------------------------------------------------------------------

export interface CatalogueEntry {
  table: string;
  section: string;
  /** What the first cell says beside the name: restricted, append-only, partitioned. */
  qualifier: string | null;
  /** The key-columns cell: the documented purpose and columns. */
  note: string;
  /**
   * The status cell: built, with the migrations that created the row's tables, or planned, with
   * the phase that builds it (`Built (0004)`, `Planned (Phase 2)`); null when the row has none.
   */
  status: { built: boolean; detail: string } | null;
}

function tableNamesIn(cell: string): { names: string[]; qualifier: string | null } {
  const qualifiers = [...cell.matchAll(/\(([^)]*)\)/g)].map((m) => m[1] ?? '');
  const bare = cell.replace(/\([^)]*\)/g, '');
  const names = [...bare.matchAll(/`([a-z_]+)`/g)].map((m) => m[1] ?? '');
  return { names, qualifier: qualifiers.length > 0 ? qualifiers.join('; ') : null };
}

/** Splits `a (x, y), b, c (z)` at the commas outside brackets. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else current += ch;
  }
  if (current.trim() !== '') parts.push(current.trim());
  return parts;
}

/** Every table DATABASE.md §6 names, with its section, status and documented columns. */
export function parseCatalogue(databaseDoc: string): CatalogueEntry[] {
  const lines = databaseDoc.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith('## 6.'));
  const end = lines.findIndex((l, i) => i > start && /^## \d/.test(l));
  const entries: CatalogueEntry[] = [];
  let section = '';
  for (const line of lines.slice(start, end === -1 ? undefined : end)) {
    const heading = /^### (6\.\d+ .+)$/.exec(line);
    if (heading?.[1] !== undefined) {
      section = heading[1];
      continue;
    }
    if (section === '') continue;
    const row = /^\| (.+?) \| (.+) \|$/.exec(line);
    if (row?.[1] !== undefined && row[2] !== undefined && row[1].includes('`')) {
      const { names, qualifier } = tableNamesIn(row[1]);
      const marked = /^(Built|Planned) \(([^)]*)\) \| (.+)$/.exec(row[2]);
      const status =
        marked?.[1] === undefined ? null : { built: marked[1] === 'Built', detail: marked[2] ?? '' };
      const note = marked?.[3] ?? row[2];
      for (const table of names) entries.push({ table, section, qualifier, note, status });
      continue;
    }
    // A section written as one line: `a`, `b` (`col`, `col`), ...
    if (line.startsWith('`')) {
      for (const part of splitTopLevel(line.replace(/\.$/, ''))) {
        const name = /^`([a-z_]+)`/.exec(part)?.[1];
        if (name === undefined) continue;
        const columns = /\((.*)\)$/.exec(part)?.[1] ?? '';
        entries.push({ table: name, section, qualifier: null, note: columns, status: null });
      }
    }
  }
  return entries;
}

// --- Planned tables --------------------------------------------------------------------------

export interface PlannedColumn {
  name: string;
  /** The type DATABASE.md states, or the one its §2 naming conventions fix, or null. */
  type: string | null;
  /** DATABASE.md writes `column null` for a column that may be empty. */
  nullable: boolean;
  /** The table a `*_id` column refers to, inferred from its name. */
  references: string | null;
}

/**
 * `*_id` stems whose table is not the plain plural of the stem. Everything else resolves by
 * pluralising the stem, then its shorter tails (`receipt_file_id` → `files`).
 */
const REFERENCE_ALIASES: Record<string, string> = {
  so: 'sales_orders',
  so_line: 'sales_order_lines',
  po: 'purchase_orders',
  site: 'customer_sites',
  location: 'org_locations',
  tier: 'price_tiers',
  channel: 'entity_channels',
  thread: 'whatsapp_threads',
  disposition: 'call_dispositions',
  source: 'lead_sources',
  stage: 'pipeline_stages',
  composite_rule: 'composite_supply_rules',
  flow_template: 'project_flow_templates',
  application: 'subsidy_applications',
  claim: 'expense_claims',
  receipt: 'goods_receipts',
  movement: 'stock_movements',
  cost_entry: 'job_cost_entries',
  voucher: 'tally_vouchers',
  run: 'agent_runs',
};

function pluralCandidates(stem: string): string[] {
  const plurals = [`${stem}s`, `${stem}es`];
  if (stem.endsWith('y')) plurals.push(`${stem.slice(0, -1)}ies`);
  return plurals;
}

/** The table a `*_id` column names, or null when its name does not lead to one. */
export function inferReference(
  table: string,
  column: string,
  knownTables: ReadonlySet<string>,
): string | null {
  if (column === 'reverses_id') return table;
  if (!column.endsWith('_id') || column.startsWith('provider_') || column === 'ref_id') return null;
  const words = column.slice(0, -'_id'.length).split('_');
  for (let i = 0; i < words.length; i += 1) {
    const stem = words.slice(i).join('_');
    const alias = REFERENCE_ALIASES[stem];
    if (alias !== undefined && knownTables.has(alias)) return alias;
    const found = pluralCandidates(stem).find((t) => knownTables.has(t));
    if (found !== undefined) return found;
  }
  return null;
}

/** The type DATABASE.md §2 fixes by a column's name, when it fixes one. */
function conventionalType(column: string, references: string | null): string | null {
  if (column === 'entity_id') return 'smallint';
  if (references !== null) return 'uuid';
  if (column.endsWith('_at')) return 'timestamptz';
  if (column.startsWith('is_')) return 'boolean';
  if (column.endsWith('_json')) return 'jsonb';
  return null;
}

/** Removes every bracketed aside that is not inside a code span (value lists, remarks). */
function withoutAsides(text: string): string {
  let out = '';
  let depth = 0;
  let inCode = false;
  for (const ch of text) {
    if (ch === '`' && depth === 0) inCode = !inCode;
    if (!inCode && ch === '(') depth += 1;
    if (depth === 0) out += ch;
    if (!inCode && ch === ')' && depth > 0) depth -= 1;
  }
  return out;
}

/**
 * The columns a planned table's catalogue note documents: the code spans of its key-column list
 * (the note up to its first semicolon), leaving out value lists in brackets and the names of
 * other tables. A note that does not open with a column documents none.
 */
export function plannedColumns(
  entry: CatalogueEntry,
  knownTables: ReadonlySet<string>,
): PlannedColumn[] {
  const note = withoutAsides(entry.note).trim();
  if (!note.startsWith('`')) return [];
  const list = note.split(';')[0] ?? '';
  const columns: PlannedColumn[] = [];
  for (const span of list.matchAll(/`([^`]+)`/g)) {
    const parsed = /^([a-z_][a-z0-9_]*)(?: (.+))?$/.exec(span[1] ?? '');
    const name = parsed?.[1];
    if (name === undefined || knownTables.has(name) || columns.some((c) => c.name === name)) {
      continue;
    }
    const stated = parsed?.[2];
    const references = inferReference(entry.table, name, knownTables);
    columns.push({
      name,
      type: stated !== undefined && stated !== 'null' ? stated : conventionalType(name, references),
      nullable: stated === 'null',
      references,
    });
  }
  return columns;
}

// --- Hand-written SQL ------------------------------------------------------------------------

export interface PolicyInfo {
  name: string;
  command: string;
  roles: string;
  permissive: boolean;
  using: string | null;
  withCheck: string | null;
  migration: string;
}

export interface SqlTableInfo {
  rlsEnabled: boolean;
  rlsForced: boolean;
  policies: Map<string, PolicyInfo>;
  triggers: Map<string, { timing: string; events: string; action: string; migration: string }>;
  exclusions: Map<string, { definition: string; migration: string }>;
  partition: string | null;
}

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** The text inside the bracket that opens at `open`, and the index after its close. */
function balanced(sql: string, open: number): { inner: string; end: number } {
  let depth = 0;
  let quoted = false;
  for (let i = open; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'") quoted = !quoted;
    if (quoted) continue;
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return { inner: sql.slice(open + 1, i), end: i + 1 };
    }
  }
  throw new Error(`unbalanced bracket at ${String(open)}`);
}

const ident = String.raw`(?:"?public"?\.)?"?([a-z_]+)"?`;

/** `select` and the other commands as `pg_policies.cmd` writes them, for a policy's command. */
const POLICY_COMMANDS: Record<string, string> = {
  SELECT: 'select',
  INSERT: 'insert',
  UPDATE: 'update',
  DELETE: 'delete',
  ALL: 'all',
};

const roleList = (roles: string): string[] =>
  roles
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r !== '');

/**
 * A `do $$ … $$` block that walks `pg_policies` and adds a role to every policy that names
 * another one, as 0062 gives `app_reader` every read policy of `app_user`:
 * `where 'app_user' = any (roles) and not 'app_reader' = any (roles) and cmd in ('SELECT', 'ALL')`
 * followed by an `alter policy` that appends `array['app_reader']` to the roles. Only that shape is
 * read; any other dynamic SQL is left alone, and a test pins the shape to the migration.
 */
export interface PolicyRoleSweep {
  holder: string;
  added: string;
  commands: string[];
}

export function parsePolicyRoleSweep(block: string): PolicyRoleSweep | null {
  if (!/from\s+pg_policies/i.test(block) || !/alter policy/i.test(block)) return null;
  const where =
    /'([a-z_]+)'\s*=\s*any\s*\(\s*roles\s*\)\s+and\s+not\s+'([a-z_]+)'\s*=\s*any\s*\(\s*roles\s*\)\s+and\s+cmd\s+in\s*\(([^)]*)\)/i.exec(
      block,
    );
  const appended = /roles\s*\|\|\s*array\[\s*'([a-z_]+)'\s*\]/i.exec(block);
  if (where === null || appended === null || appended[1] !== where[2]) return null;
  const commands = [...(where[3] ?? '').matchAll(/'([A-Z]+)'/g)]
    .map((c) => POLICY_COMMANDS[c[1] ?? ''])
    .filter((c) => c !== undefined);
  return { holder: where[1] ?? '', added: where[2] ?? '', commands };
}

/** Applies every migration in order and returns the resulting SQL-only facts per table. */
export function parseMigrations(migrations: readonly MigrationFile[]): Map<string, SqlTableInfo> {
  const tables = new Map<string, SqlTableInfo>();
  const info = (table: string): SqlTableInfo => {
    let found = tables.get(table);
    if (found === undefined) {
      found = {
        rlsEnabled: false,
        rlsForced: false,
        policies: new Map(),
        triggers: new Map(),
        exclusions: new Map(),
        partition: null,
      };
      tables.set(table, found);
    }
    return found;
  };

  const patterns: { re: RegExp; apply: (m: RegExpExecArray, sql: string, file: string) => void }[] =
    [
      {
        re: new RegExp(
          String.raw`alter table\s+(?:if exists\s+)?${ident}\s+(enable|force|disable|no force) row level security`,
          'gi',
        ),
        apply: (m) => {
          const t = info(m[1] ?? '');
          const action = (m[2] ?? '').toLowerCase();
          if (action === 'enable') t.rlsEnabled = true;
          if (action === 'disable') t.rlsEnabled = false;
          if (action === 'force') t.rlsForced = true;
          if (action === 'no force') t.rlsForced = false;
        },
      },
      {
        re: new RegExp(
          String.raw`create policy\s+"?([a-z_]+)"?\s+on\s+${ident}(\s+as\s+(?:permissive|restrictive))?(?:\s+for\s+(select|insert|update|delete|all))?(?:\s+to\s+([a-z_, ]+?))?\s*(?=using|with check|;)`,
          'gi',
        ),
        apply: (m, sql, file) => {
          let cursor = m.index + m[0].length;
          const clause = (keyword: RegExp): string | null => {
            const rest = sql.slice(cursor);
            const k = keyword.exec(rest);
            if (k?.index !== 0) return null;
            const open = cursor + k[0].length - 1;
            const { inner, end } = balanced(sql, open);
            cursor = end;
            while (/\s/.test(sql[cursor] ?? '')) cursor += 1;
            return squash(inner);
          };
          const using = clause(/^using\s*\(/i);
          const withCheck = clause(/^with check\s*\(/i);
          info(m[2] ?? '').policies.set(m[1] ?? '', {
            name: m[1] ?? '',
            permissive: !/restrictive/i.test(m[3] ?? ''),
            command: (m[4] ?? 'all').toLowerCase(),
            roles: squash(m[5] ?? 'public'),
            using,
            withCheck,
            migration: file,
          });
        },
      },
      {
        // `alter policy … to roles [using (…)] [with check (…)]`; a rename is not handled.
        re: new RegExp(
          String.raw`alter policy\s+"?([a-z_]+)"?\s+on\s+${ident}(?:\s+to\s+([a-z_, ]+?))?\s*(?=using|with check|;|$)`,
          'gi',
        ),
        apply: (m, sql, file) => {
          const policy = info(m[2] ?? '').policies.get(m[1] ?? '');
          if (policy === undefined) {
            throw new Error(`${file}: alter policy ${m[1] ?? ''} on ${m[2] ?? ''} before it exists`);
          }
          let cursor = m.index + m[0].length;
          const clause = (keyword: RegExp): string | null => {
            const k = keyword.exec(sql.slice(cursor));
            if (k?.index !== 0) return null;
            const { inner, end } = balanced(sql, cursor + k[0].length - 1);
            cursor = end;
            while (/\s/.test(sql[cursor] ?? '')) cursor += 1;
            return squash(inner);
          };
          if (m[3] !== undefined) policy.roles = roleList(m[3]).join(', ');
          policy.using = clause(/^using\s*\(/i) ?? policy.using;
          policy.withCheck = clause(/^with check\s*\(/i) ?? policy.withCheck;
          policy.migration = file;
        },
      },
      {
        // A `do` block that adds a role to every policy naming another (0062: `app_reader`).
        re: /do\s+\$\$([\s\S]*?)\$\$/gi,
        apply: (m, _sql, file) => {
          const sweep = parsePolicyRoleSweep(m[1] ?? '');
          if (sweep === null) return;
          for (const table of tables.values()) {
            for (const policy of table.policies.values()) {
              const roles = roleList(policy.roles);
              if (
                roles.includes(sweep.holder) &&
                !roles.includes(sweep.added) &&
                sweep.commands.includes(policy.command)
              ) {
                policy.roles = [...roles, sweep.added].join(', ');
                policy.migration = file;
              }
            }
          }
        },
      },
      {
        re: new RegExp(String.raw`drop policy\s+(?:if exists\s+)?"?([a-z_]+)"?\s+on\s+${ident}`, 'gi'),
        apply: (m) => {
          info(m[2] ?? '').policies.delete(m[1] ?? '');
        },
      },
      {
        re: new RegExp(
          String.raw`create (?:or replace )?(?:constraint )?trigger\s+"?([a-z_]+)"?\s+(before|after|instead of)\s+([a-z ,]+?)\s+on\s+${ident}([\s\S]*?)execute (?:function|procedure)\s+([a-z_.]+)`,
          'gi',
        ),
        apply: (m, _sql, file) => {
          info(m[4] ?? '').triggers.set(m[1] ?? '', {
            timing: (m[2] ?? '').toLowerCase(),
            events: squash(m[3] ?? '').toLowerCase(),
            action: m[6] ?? '',
            migration: file,
          });
        },
      },
      {
        re: new RegExp(String.raw`drop trigger\s+(?:if exists\s+)?"?([a-z_]+)"?\s+on\s+${ident}`, 'gi'),
        apply: (m) => {
          info(m[2] ?? '').triggers.delete(m[1] ?? '');
        },
      },
      {
        re: new RegExp(
          String.raw`alter table\s+${ident}\s+add constraint\s+"?([a-z_]+)"?\s+exclude using\s+([a-z]+)\s*\(`,
          'gi',
        ),
        apply: (m, sql, file) => {
          const { inner } = balanced(sql, m.index + m[0].length - 1);
          info(m[1] ?? '').exclusions.set(m[2] ?? '', {
            definition: `exclude using ${m[3] ?? ''} (${squash(inner)})`,
            migration: file,
          });
        },
      },
      {
        re: new RegExp(String.raw`alter table\s+${ident}\s+drop constraint\s+(?:if exists\s+)?"?([a-z_]+)"?`, 'gi'),
        apply: (m) => {
          info(m[1] ?? '').exclusions.delete(m[2] ?? '');
        },
      },
      {
        re: new RegExp(String.raw`create table\s+(?:if not exists\s+)?${ident}\s*\(`, 'gi'),
        apply: (m, sql) => {
          const { end } = balanced(sql, m.index + m[0].length - 1);
          const partition = /^\s*partition by\s+(range|list|hash)\s*\(([^)]*)\)/i.exec(sql.slice(end));
          if (partition !== null) {
            info(m[1] ?? '').partition =
              `${(partition[1] ?? '').toLowerCase()} (${(partition[2] ?? '').replace(/"/g, '')})`;
          }
        },
      },
    ];

  for (const file of migrations) {
    const sql = stripComments(file.sql);
    const hits: { index: number; run: () => void }[] = [];
    for (const { re, apply } of patterns) {
      re.lastIndex = 0;
      for (let m = re.exec(sql); m !== null; m = re.exec(sql)) {
        const match = m;
        hits.push({
          index: match.index,
          run: () => {
            apply(match, sql, file.name);
          },
        });
      }
    }
    for (const hit of hits.sort((a, b) => a.index - b.index)) hit.run();
  }
  return tables;
}

// --- Modules ---------------------------------------------------------------------------------

export interface Module {
  key: string;
  title: string;
  tables: string[];
}

/** Built tables by module; a table not listed takes the module of its DATABASE.md section. */
const MODULE_TABLES: Record<string, { title: string; tables: string[] }> = {
  org: {
    title: 'Org',
    tables: [
      'entities',
      'principals',
      'roles',
      'permissions',
      'role_permissions',
      'teams',
      'document_sequences',
    ],
  },
  identity: {
    title: 'Identity',
    tables: [
      'users',
      'user_entity_roles',
      'sessions',
      'auth_accounts',
      'auth_verifications',
      'user_two_factor',
    ],
  },
  crm: { title: 'CRM', tables: [] },
  catalogue: { title: 'Catalogue, pricing and tax', tables: [] },
  platform: { title: 'Platform', tables: ['idempotency_keys'] },
};

const SECTION_MODULE: Record<string, string> = {
  '6.1': 'org',
  '6.2': 'crm',
  '6.3': 'catalogue',
  '6.10': 'platform',
};

function moduleKeyForSection(section: string): { key: string; title: string } {
  const number = section.split(' ')[0] ?? '';
  const key = SECTION_MODULE[number];
  if (key !== undefined) return { key, title: MODULE_TABLES[key]?.title ?? key };
  const title = section.slice(number.length).trim();
  return { key: title.toLowerCase().replace(/[^a-z]+/g, '-'), title };
}

export function groupModules(builtTables: readonly string[], catalogue: CatalogueEntry[]): Module[] {
  const modules = new Map<string, Module>(
    Object.entries(MODULE_TABLES).map(([key, m]) => [key, { key, title: m.title, tables: [] }]),
  );
  for (const table of [...builtTables].sort()) {
    let key = Object.entries(MODULE_TABLES).find(([, m]) => m.tables.includes(table))?.[0];
    if (key === undefined) {
      const entry = catalogue.find((e) => e.table === table);
      const found = entry === undefined ? { key: 'other', title: 'Other' } : moduleKeyForSection(entry.section);
      key = found.key;
      if (!modules.has(key)) modules.set(key, { key, title: found.title, tables: [] });
    }
    modules.get(key)?.tables.push(table);
  }
  return [...modules.values()].filter((m) => m.tables.length > 0);
}

// --- Rendering -------------------------------------------------------------------------------

/** Columns most tables carry for the audit of who changed them; described once, not drawn. */
const ACTOR_COLUMNS = new Set(['created_by', 'updated_by']);

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const code = (text: string): string => (text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``);

/**
 * A column type as Mermaid accepts it (a word, no comma or space), with what it leaves out: the
 * precision of `numeric(14, 2)` goes to the attribute's comment.
 */
export function mermaidType(type: string): { type: string; detail: string | null } {
  const sized = /^([a-z ]+)\((\d+(?:,\s*\d+)?)\)$/.exec(type);
  const base = sized?.[1] ?? type;
  const detail = sized?.[2] === undefined ? null : `(${sized[2].replace(/\s+/g, '')})`;
  return {
    type: base.replace(' with time zone', 'tz').trim().replace(/\s+/g, '_'),
    detail,
  };
}

/** The attribute's trailing comment: the precision a type leaves out and whether it may be null. */
function attributeComment(detail: string | null, nullable: boolean): string {
  const parts = [detail, nullable ? 'null' : null].filter((p) => p !== null);
  return parts.length > 0 ? ` "${parts.join(', ')}"` : '';
}

/** Tables without one or both actor columns, for the ERD's opening note. */
function actorExceptions(tables: Map<string, SnapshotTable>): { none: string[]; partial: string[] } {
  const none: string[] = [];
  const partial: string[] = [];
  for (const [name, table] of [...tables.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const held = [...ACTOR_COLUMNS].filter((c) => table.columns[c] !== undefined);
    if (held.length === 0) none.push(name);
    else if (held.length < ACTOR_COLUMNS.size) {
      partial.push(`${code(name)} (only ${held.map(code).join(', ')})`);
    }
  }
  return { none, partial };
}

function primaryKeyOf(table: SnapshotTable): string[] {
  const composite = Object.values(table.compositePrimaryKeys)[0];
  if (composite !== undefined) return composite.columns;
  return Object.values(table.columns)
    .filter((c) => c.primaryKey)
    .map((c) => c.name);
}

function isUniqueSet(table: SnapshotTable, columns: readonly string[]): boolean {
  const same = (a: readonly string[]) =>
    a.length === columns.length && a.every((c) => columns.includes(c));
  return (
    same(primaryKeyOf(table)) ||
    Object.values(table.uniqueConstraints).some((u) => same(u.columns)) ||
    Object.values(table.indexes).some(
      (i) => i.isUnique && i.where === undefined && same(i.columns.map((c) => c.expression)),
    )
  );
}

function header(sources: DataDocSources, title: string, lead: string): string[] {
  const last = sources.migrations.at(-1)?.name.replace(/\.sql$/, '') ?? '';
  return [
    `# ${title}`,
    '',
    `${lead} Generated by \`pnpm db:docs\` from \`packages/db/migrations/meta/${sources.snapshotFile}\`, the SQL migrations up to \`${last}\` and the table catalogue in [DATABASE.md](../DATABASE.md) §6; \`packages/db/src/docs/data-docs.test.ts\` fails when this file and those sources differ, so it is regenerated, never edited.`,
    '',
  ];
}

export interface DataDocs {
  erd: string;
  dictionary: string;
}

export function renderDataDocs(sources: DataDocSources): DataDocs {
  const tables = new Map(Object.values(sources.snapshot.tables).map((t) => [t.name, t]));
  const catalogue = parseCatalogue(sources.databaseDoc);
  const sql = parseMigrations(sources.migrations);
  const modules = groupModules([...tables.keys()], catalogue);
  const known = new Set([...tables.keys(), ...catalogue.map((e) => e.table)]);
  const planned = catalogue
    .filter((e) => !tables.has(e.table))
    .map((entry) => ({ entry, columns: plannedColumns(entry, known) }));
  return {
    erd: renderErd(sources, tables, modules, planned),
    dictionary: renderDictionary(sources, tables, modules, catalogue, planned, sql),
  };
}

interface PlannedTable {
  entry: CatalogueEntry;
  columns: PlannedColumn[];
}

/** `6.4 Sales` → `Sales`. */
const sectionTitle = (section: string): string => section.replace(/^[\d.]+\s+/, '');

/** Planned tables by DATABASE.md §6 section, in the catalogue's order. */
function plannedSections(planned: readonly PlannedTable[]): [string, PlannedTable[]][] {
  const sections = [...new Set(planned.map((p) => p.entry.section))];
  return sections.map((section) => [section, planned.filter((p) => p.entry.section === section)]);
}

function renderErd(
  sources: DataDocSources,
  tables: Map<string, SnapshotTable>,
  modules: Module[],
  planned: readonly PlannedTable[],
): string {
  const out = header(
    sources,
    'Entity-relationship diagram — Shakti Prime BOS',
    'The tables built so far, one diagram per module; a table another module owns appears as a name only.',
  );
  const actors = actorExceptions(tables);
  const exceptions = [
    actors.none.length > 0 ? `Tables without either: ${actors.none.map(code).join(', ')}.` : null,
    actors.partial.length > 0
      ? `Tables with one of them: ${actors.partial.join(', ')}.`
      : null,
  ].filter((e) => e !== null);
  out.push(
    `Most tables also carry \`created_by\` and \`updated_by\`, which reference \`principals\`; those links are left out of the diagrams. ${exceptions.join(' ')}`.trimEnd(),
    '',
    'A type with a precision is drawn without it, and the precision is in the comment (`numeric "(14,2)"`), as is "null" for a column that may be empty. Column types, constraints and row-level security are in the [data dictionary](DATA-DICTIONARY.md); tables still to be built are drawn under [Planned tables](#planned-tables) from their DATABASE.md §6 entries.',
    '',
  );
  for (const module of modules) {
    out.push(`## ${module.title}`, '', '```mermaid', 'erDiagram');
    for (const name of module.tables) {
      const table = tables.get(name);
      if (table === undefined) continue;
      const pk = new Set(primaryKeyOf(table));
      const fkColumns = new Set(
        Object.values(table.foreignKeys)
          .flatMap((f) => f.columnsFrom)
          .filter((c) => !ACTOR_COLUMNS.has(c)),
      );
      const unique = new Set(
        Object.values(table.uniqueConstraints)
          .filter((u) => u.columns.length === 1)
          .flatMap((u) => u.columns),
      );
      out.push(`  ${name} {`);
      for (const column of Object.values(table.columns)) {
        if (ACTOR_COLUMNS.has(column.name)) continue;
        const keys = [
          pk.has(column.name) ? 'PK' : null,
          fkColumns.has(column.name) ? 'FK' : null,
          unique.has(column.name) ? 'UK' : null,
        ].filter((k) => k !== null);
        const nullable = !(column.notNull || pk.has(column.name));
        const { type, detail } = mermaidType(column.type);
        out.push(
          `    ${type} ${column.name}${keys.length > 0 ? ` ${keys.join(', ')}` : ''}${attributeComment(detail, nullable)}`,
        );
      }
      out.push('  }');
    }
    for (const name of module.tables) {
      const table = tables.get(name);
      if (table === undefined) continue;
      const fks = Object.values(table.foreignKeys)
        .filter((f) => !f.columnsFrom.every((c) => ACTOR_COLUMNS.has(c)))
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const fk of fks) {
        const required = fk.columnsFrom.every((c) => table.columns[c]?.notNull === true);
        const one = isUniqueSet(table, fk.columnsFrom);
        const left = one ? (required ? '||' : '|o') : '}o';
        const right = required ? '||' : 'o|';
        out.push(`  ${fk.tableFrom} ${left}--${right} ${fk.tableTo} : "${fk.columnsFrom.join(', ')}"`);
      }
    }
    out.push('```', '');
  }

  out.push(
    '## Planned tables',
    '',
    "Tables DATABASE.md §6 documents that no migration has created yet, one diagram per section. Each shows the columns its entry names and the standard `id` of DATABASE.md §2. A type comes from the entry or from the §2 naming conventions (`entity_id` smallint, other `*_id` references uuid, `*_at` timestamptz, `is_*` boolean, `*_json` jsonb); a column whose type neither fixes shows `untyped`. A relationship is inferred from a `*_id` column's name and drawn to the table it names; the migration that builds the table fixes the real keys, and the table then moves to its module above.",
    '',
  );
  for (const [section, entries] of plannedSections(planned)) {
    out.push(`### ${sectionTitle(section)}`, '', '```mermaid', 'erDiagram');
    for (const { entry, columns } of entries) {
      out.push(`  ${entry.table} {`);
      if (!columns.some((c) => c.name === 'id')) out.push('    uuid id PK');
      for (const column of columns) {
        const key = column.references === null ? '' : ' FK';
        const { type, detail } = mermaidType(column.type ?? 'untyped');
        out.push(`    ${type} ${column.name}${key}${attributeComment(detail, column.nullable)}`);
      }
      out.push('  }');
    }
    for (const { entry, columns } of entries) {
      for (const column of columns) {
        if (column.references === null) continue;
        const self = column.references === entry.table;
        const right = column.nullable || self ? 'o|' : '||';
        out.push(`  ${entry.table} }o--${right} ${column.references} : "${column.name}"`);
      }
    }
    out.push('```', '');
  }
  return `${out.join('\n').trimEnd()}\n`;
}

function renderDictionary(
  sources: DataDocSources,
  tables: Map<string, SnapshotTable>,
  modules: Module[],
  catalogue: CatalogueEntry[],
  planned: readonly PlannedTable[],
  sql: Map<string, SqlTableInfo>,
): string {
  const out = header(
    sources,
    'Data dictionary — Shakti Prime BOS',
    'Every table built so far, by module, with its columns, keys, constraints, indexes, triggers and row-level security, followed by the tables DATABASE.md §6 plans for later phases.',
  );
  out.push('## Contents', '');
  for (const module of modules) {
    out.push(`- **${module.title}:** ${module.tables.map((t) => `[\`${t}\`](#${t})`).join(', ')}`);
  }
  out.push('- [Planned tables](#planned-tables)', '');

  for (const module of modules) {
    out.push(`## ${module.title}`, '');
    for (const name of module.tables) {
      const table = tables.get(name);
      if (table === undefined) continue;
      out.push(...renderTable(table, catalogue.find((e) => e.table === name), sql.get(name)));
    }
  }

  out.push('## Planned tables', '');
  out.push(
    'Tables DATABASE.md §6 documents that no migration has created yet, with the columns documented for them and the tables their `*_id` columns name, as the [ERD](ERD.md#planned-tables) draws them. Each gains a full entry above when its migration lands.',
    '',
  );
  for (const [section, entries] of plannedSections(planned)) {
    out.push(
      `### ${section}`,
      '',
      '| Table | Phase | Documented columns | Refers to (inferred) |',
      '|---|---|---|---|',
    );
    for (const { entry, columns } of entries) {
      const qualifier = entry.qualifier === null ? '' : ` (${entry.qualifier})`;
      const refs = columns
        .filter((c) => c.references !== null)
        .map((c) => `\`${c.name}\` → \`${c.references ?? ''}\``)
        .join(', ');
      out.push(
        `| \`${entry.table}\`${cell(qualifier)} | ${cell(entry.status?.detail ?? '')} | ${cell(entry.note)} | ${cell(refs)} |`,
      );
    }
    out.push('');
  }
  return `${out.join('\n').trimEnd()}\n`;
}

function renderTable(
  table: SnapshotTable,
  entry: CatalogueEntry | undefined,
  sql: SqlTableInfo | undefined,
): string[] {
  const out: string[] = [`### ${table.name}`, ''];
  const facts: string[] = [];
  if (entry !== undefined) facts.push(`DATABASE.md §${entry.section.split(' ')[0] ?? ''}`);
  if (entry?.status?.built === true) facts.push(`created in ${entry.status.detail}`);
  if (entry?.qualifier) facts.push(entry.qualifier);
  if (sql?.partition) facts.push(`partitioned by ${sql.partition}`);
  out.push(
    entry === undefined
      ? `**Catalogue entry:** none in DATABASE.md §6${sql?.partition ? `; partitioned by ${sql.partition}` : ''}.`
      : `**Catalogue entry** (${facts.join('; ')}): ${entry.note}`,
    '',
  );

  const pk = new Set(primaryKeyOf(table));
  const references = new Map<string, string>();
  for (const fk of Object.values(table.foreignKeys)) {
    if (fk.columnsFrom.length === 1 && fk.columnsFrom[0] !== undefined) {
      references.set(fk.columnsFrom[0], `${fk.tableTo}.${fk.columnsTo.join(', ')}`);
    }
  }
  out.push('| Column | Type | Null | Default | Key |', '|---|---|---|---|---|');
  for (const column of Object.values(table.columns)) {
    const keys = [pk.has(column.name) ? 'PK' : '', references.has(column.name) ? `→ \`${references.get(column.name) ?? ''}\`` : '']
      .filter((k) => k !== '')
      .join(' ');
    const fallback =
      column.default !== undefined
        ? code(
            typeof column.default === 'string'
              ? column.default
              : JSON.stringify(column.default),
          )
        : column.identity !== undefined
          ? 'identity'
          : '';
    out.push(
      `| \`${column.name}\` | ${column.type} | ${column.notNull || pk.has(column.name) ? 'no' : 'yes'} | ${cell(fallback)} | ${cell(keys)} |`,
    );
  }
  out.push('');

  const list = (title: string, items: string[]) => {
    if (items.length === 0) return;
    out.push(`**${title}**`, '', ...items.map((i) => `- ${i}`), '');
  };
  list('Primary key', pk.size > 0 ? [`(${[...pk].map((c) => `\`${c}\``).join(', ')})`] : []);
  list(
    'Unique constraints',
    Object.values(table.uniqueConstraints)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((u) => `\`${u.name}\`: (${u.columns.map((c) => `\`${c}\``).join(', ')})`),
  );
  list(
    'Foreign keys',
    Object.values(table.foreignKeys)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (f) =>
          `\`${f.name}\`: (${f.columnsFrom.map((c) => `\`${c}\``).join(', ')}) → \`${f.tableTo}\` (${f.columnsTo.map((c) => `\`${c}\``).join(', ')})${f.onDelete && f.onDelete !== 'no action' ? `, on delete ${f.onDelete}` : ''}`,
      ),
  );
  list('Check constraints', [
    ...Object.values(table.checkConstraints)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => `\`${c.name}\`: ${code(squash(c.value))}`),
    ...[...(sql?.exclusions.entries() ?? [])]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, e]) => `\`${name}\`: ${code(e.definition)} (${e.migration})`),
  ]);
  list(
    'Indexes',
    Object.values(table.indexes)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((i) => {
        const columns = i.columns
          .map((c) => `${c.expression}${c.asc ? '' : ' desc'}${c.opclass ? ` ${c.opclass}` : ''}`)
          .join(', ');
        const kind = [i.method, i.isUnique ? 'unique' : null].filter((k) => k !== null).join(', ');
        return `\`${i.name}\` (${kind}): ${code(columns)}${i.where ? ` where ${code(squash(i.where))}` : ''}`;
      }),
  );
  list(
    'Triggers',
    [...(sql?.triggers.entries() ?? [])]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, t]) => `\`${name}\`: ${t.timing} ${t.events}, runs \`${t.action}()\``),
  );

  const policies = [...(sql?.policies.values() ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const rls = sql?.rlsEnabled
    ? `enabled${sql.rlsForced ? ' and forced' : ', not forced'}; ${String(policies.length)} ${policies.length === 1 ? 'policy' : 'policies'}${policies.length === 0 ? ', so no request role reads or writes a row' : ''}`
    : 'not enabled';
  out.push(`**Row-level security:** ${rls}.`, '');
  if (policies.length > 0) {
    out.push(
      ...policies.map((p) => {
        const clauses = [
          p.using === null ? null : `using ${code(p.using)}`,
          p.withCheck === null ? null : `with check ${code(p.withCheck)}`,
        ].filter((c) => c !== null);
        return `- \`${p.name}\` (${p.command}${p.permissive ? '' : ', restrictive'}, to ${p.roles}): ${clauses.join('; ')}`;
      }),
      '',
    );
  }
  return out;
}
