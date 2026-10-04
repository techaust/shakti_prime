import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  groupModules,
  inferReference,
  mermaidType,
  parseCatalogue,
  parseMigrations,
  parsePolicyRoleSweep,
  plannedColumns,
  readSources,
  renderDataDocs,
} from './data-docs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (file: string) => readFileSync(join(repoRoot, 'docs', 'data', file), 'utf8');
const lf = (text: string) => text.replace(/\r\n/g, '\n');

describe('the ERD and data dictionary (docs/data)', () => {
  const sources = readSources(repoRoot);
  const docs = renderDataDocs(sources);

  it('match the latest snapshot, the migrations and DATABASE.md; run pnpm db:docs when not', () => {
    expect(lf(read('ERD.md'))).toBe(docs.erd);
    expect(lf(read('DATA-DICTIONARY.md'))).toBe(docs.dictionary);
  });

  it('cover every built table and place each in the dictionary once', () => {
    for (const table of Object.values(sources.snapshot.tables)) {
      expect(docs.dictionary.match(new RegExp(`^### ${table.name}$`, 'gm'))).toHaveLength(1);
      expect(docs.erd).toContain(`  ${table.name} {`);
    }
  });

  it('place every built table in a module, never under Other (give it a DATABASE.md §6 entry)', () => {
    const catalogue = parseCatalogue(sources.databaseDoc);
    const modules = groupModules(
      Object.values(sources.snapshot.tables).map((t) => t.name),
      catalogue,
    );
    expect(modules.find((m) => m.key === 'other')?.tables ?? []).toEqual([]);
  });

  it('name app_reader on the read policies 0062 and 0089 give it', () => {
    const tables = parseMigrations(sources.migrations);
    expect(tables.get('activities')?.policies.get('activities_read')?.roles).toBe(
      'app_user, app_reader',
    );
    expect(tables.get('users')?.policies.get('users_read')?.roles).toBe('app_user, app_reader');
    const sweep = sources.migrations.find((m) => m.name.startsWith('0062_'));
    const blocks = [...(sweep?.sql ?? '').matchAll(/do\s+\$\$([\s\S]*?)\$\$/gi)];
    expect(blocks.map((b) => parsePolicyRoleSweep(b[1] ?? '')).filter((s) => s !== null)).toEqual([
      { holder: 'app_user', added: 'app_reader', commands: ['select', 'all'] },
    ]);
  });

  it('list the tables DATABASE.md plans and no migration has built', () => {
    expect(docs.dictionary).toContain('| `quotes` |');
    expect(docs.dictionary).toContain('| `employees` |');
    expect(docs.dictionary).not.toMatch(/^\| `opportunities` \|/m);
  });

  it('draw the planned tables per section, related by their documented *_id columns', () => {
    const planned = docs.erd.slice(docs.erd.indexOf('## Planned tables'));
    expect(planned).toContain('### Sales');
    expect(planned).toContain('  quotes {');
    expect(planned).toContain('  quote_lines }o--|| quotes : "quote_id"');
    expect(planned).toContain('  sales_orders }o--o| quotes : "quote_id"');
    expect(planned).toContain('  quotes }o--|| customer_sites : "site_id"');
    expect(planned).not.toContain('  opportunities {');
  });
});

describe('planned tables', () => {
  const known = new Set(['quotes', 'files', 'customer_sites', 'stock_movements', 'quote_lines']);

  it('reads the documented columns, leaving out value lists, remarks and other tables', () => {
    const columns = plannedColumns(
      {
        table: 'quotes',
        section: '6.4 Sales',
        qualifier: null,
        note: '`site_id null`, `state` (`draft`, `sent`), `pdf_file_id`, `embedding vector(1024)`, price columns as `quote_lines`; `later` after the list',
      },
      known,
    );
    expect(columns).toEqual([
      { name: 'site_id', type: 'uuid', nullable: true, references: 'customer_sites' },
      { name: 'state', type: null, nullable: false, references: null },
      { name: 'pdf_file_id', type: 'uuid', nullable: false, references: 'files' },
      { name: 'embedding', type: 'vector(1024)', nullable: false, references: null },
    ]);
  });

  it('finds a table from an id column name, an alias or a self reference', () => {
    expect(inferReference('x', 'receipt_file_id', known)).toBe('files');
    expect(inferReference('x', 'site_id', known)).toBe('customer_sites');
    expect(inferReference('stock_movements', 'reverses_id', known)).toBe('stock_movements');
    expect(inferReference('x', 'provider_call_id', known)).toBeNull();
    expect(inferReference('x', 'caller_id', known)).toBeNull();
  });
});

describe('reading the catalogue', () => {
  it('splits a row naming several tables and keeps the qualifier', () => {
    const doc = [
      '## 6. Table catalogue',
      '### 6.9 AI and voice',
      '| Table | Key columns |',
      '|---|---|',
      '| `agent_actions` (append-only) | `run_id`, `command` |',
      '| `roles`, `permissions` | `key` |',
      '### 6.8 HR',
      '`employees`, `attendance_events` (`type`, `geo`), `shifts`.',
      '## 7. Next',
    ].join('\n');
    expect(parseCatalogue(doc)).toEqual([
      {
        table: 'agent_actions',
        section: '6.9 AI and voice',
        qualifier: 'append-only',
        note: '`run_id`, `command`',
      },
      { table: 'roles', section: '6.9 AI and voice', qualifier: null, note: '`key`' },
      { table: 'permissions', section: '6.9 AI and voice', qualifier: null, note: '`key`' },
      { table: 'employees', section: '6.8 HR', qualifier: null, note: '' },
      { table: 'attendance_events', section: '6.8 HR', qualifier: null, note: '`type`, `geo`' },
      { table: 'shifts', section: '6.8 HR', qualifier: null, note: '' },
    ]);
  });
});

describe('reading the SQL migrations', () => {
  it('applies policies, drops and triggers in order across files', () => {
    const tables = parseMigrations([
      {
        name: '0001_a.sql',
        sql: [
          'alter table widgets enable row level security;',
          'alter table widgets force row level security;',
          '-- create policy widgets_commented on widgets for select using (true);',
          "create policy widgets_read on widgets for select to app_user using (entity_id = any ((select app.entity_ids())::int[]) and note <> ')');",
          'create policy widgets_insert on widgets for insert with check (true);',
          'create trigger widgets_append_only before update or delete on widgets for each row execute function app.raise_append_only();',
        ].join('\n'),
      },
      { name: '0002_b.sql', sql: 'drop policy widgets_insert on widgets;' },
    ]);
    const widgets = tables.get('widgets');
    expect(widgets?.rlsEnabled).toBe(true);
    expect(widgets?.rlsForced).toBe(true);
    expect([...(widgets?.policies.keys() ?? [])]).toEqual(['widgets_read']);
    expect(widgets?.policies.get('widgets_read')).toMatchObject({
      command: 'select',
      roles: 'app_user',
      using: "entity_id = any ((select app.entity_ids())::int[]) and note <> ')'",
      withCheck: null,
    });
    expect(widgets?.triggers.get('widgets_append_only')).toMatchObject({
      timing: 'before',
      events: 'update or delete',
      action: 'app.raise_append_only',
    });
  });

  it('applies alter policy and a do block that adds a role to the policies naming another', () => {
    const tables = parseMigrations([
      {
        name: '0001_a.sql',
        sql: [
          'create policy w_read on widgets for select to app_user using (true);',
          'create policy w_all on widgets to app_user using (true) with check (true);',
          'create policy w_insert on widgets for insert to app_user with check (true);',
          'create policy w_public on widgets for select using (true);',
          'create policy g_read on gadgets for select to app_user using (true);',
        ].join('\n'),
      },
      {
        name: '0002_b.sql',
        sql: [
          'do $$',
          'declare p record;',
          'begin',
          '  for p in select schemaname, tablename, policyname, roles from pg_policies',
          "     where 'app_user' = any (roles) and not 'app_reader' = any (roles) and cmd in ('SELECT', 'ALL')",
          '  loop',
          "    execute format('alter policy %I on %I.%I to %s', p.policyname, p.schemaname, p.tablename,",
          "      (select string_agg(quote_ident(r), ', ') from unnest(p.roles || array['app_reader']::name[]) r));",
          '  end loop;',
          'end',
          '$$;',
          'create policy late_read on widgets for select to app_user using (false);',
        ].join('\n'),
      },
      {
        name: '0003_c.sql',
        sql: "alter policy late_read on widgets to app_user, app_reader using (note <> 'x');",
      },
    ]);
    const roles = (table: string, policy: string) =>
      tables.get(table)?.policies.get(policy)?.roles;
    expect(roles('widgets', 'w_read')).toBe('app_user, app_reader');
    expect(roles('widgets', 'w_all')).toBe('app_user, app_reader');
    expect(roles('widgets', 'w_insert')).toBe('app_user');
    expect(roles('widgets', 'w_public')).toBe('public');
    expect(roles('gadgets', 'g_read')).toBe('app_user, app_reader');
    expect(tables.get('widgets')?.policies.get('late_read')).toMatchObject({
      roles: 'app_user, app_reader',
      using: "note <> 'x'",
      migration: '0003_c.sql',
    });
  });

  it('refuses an alter policy for a policy no earlier migration created', () => {
    expect(() =>
      parseMigrations([{ name: '0001_a.sql', sql: 'alter policy ghost on widgets to app_user;' }]),
    ).toThrow(/before it exists/);
  });

  it('records partitioning and exclusion constraints the snapshot cannot hold', () => {
    const tables = parseMigrations([
      {
        name: '0001_a.sql',
        sql: [
          'CREATE TABLE "logs" ("id" uuid, "created_at" timestamptz) PARTITION BY RANGE ("created_at");',
          "alter table rates add constraint rates_period_excl exclude using gist (hsn with =, daterange(a, b, '[)') with &&);",
        ].join('\n'),
      },
    ]);
    expect(tables.get('logs')?.partition).toBe('range (created_at)');
    expect(tables.get('rates')?.exclusions.get('rates_period_excl')?.definition).toBe(
      "exclude using gist (hsn with =, daterange(a, b, '[)') with &&)",
    );
  });
});

describe('mermaidType', () => {
  it('draws a type Mermaid accepts and keeps the precision for the comment', () => {
    expect(mermaidType('numeric(14, 2)')).toEqual({ type: 'numeric', detail: '(14,2)' });
    expect(mermaidType('timestamp with time zone')).toEqual({ type: 'timestamptz', detail: null });
    expect(mermaidType('uuid')).toEqual({ type: 'uuid', detail: null });
  });
});

describe('the ERD note on created_by and updated_by', () => {
  const sources = readSources(repoRoot);
  const { erd } = renderDataDocs(sources);

  it('names every built table that lacks either column, and no other', () => {
    for (const table of Object.values(sources.snapshot.tables)) {
      const lacks = !('created_by' in table.columns) || !('updated_by' in table.columns);
      const line = erd.split('\n').find((l) => l.startsWith('Most tables')) ?? '';
      const note = line.slice(line.indexOf('Tables without'));
      expect(note.includes(`\`${table.name}\``), table.name).toBe(lacks);
    }
  });

  it('draws no type with a comma or a space', () => {
    for (const line of erd.split('\n')) {
      const attribute = /^ {4}(\S+) [a-z_0-9]+/.exec(line);
      if (attribute) expect(attribute[1]).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
    }
  });
});
