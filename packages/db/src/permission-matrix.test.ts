import { readFileSync } from 'node:fs';
import { PERMISSION_KEYS, STAFF_ROLE_KEYS, type Scope, type StaffRoleKey } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { STAFF_MATRIX } from '../seeds/role-permissions';

// The approved permission table in docs/07-security.md §3.2 is where grants are decided. The seed
// transcribes it into STAFF_MATRIX, which the security suite then uses as its oracle, so a wrong
// cell would pass every test unless the transcription itself is checked against the document
// (AUDIT M42).

const COLUMNS: readonly StaffRoleKey[] = [
  'executive',
  'general_manager',
  'sales_team_lead',
  'tele_caller_cc',
  'tele_caller_lc',
  'store_manager',
  'inventory_manager',
  'project_manager',
  'field_engineer',
  'accounts',
  'hr_admin',
];

/** `crm.account.read` / `.write` → both keys; `.grn.write` is relative to the module. */
function expandKeys(cell: string): string[] {
  const parts = cell.split('/').map((p) => p.trim().replaceAll('`', ''));
  const base = parts[0] ?? '';
  const segments = base.split('.');
  const prefix = segments.slice(0, -1).join('.');
  const module = segments[0] ?? '';
  return [
    base,
    ...parts.slice(1).map((p) => {
      const rest = p.replace(/^\./, '');
      return rest.includes('.') ? `${module}.${rest}` : `${prefix}.${rest}`;
    }),
  ];
}

/** Whether a qualified cell such as `entity (read)` applies to one key of a compound row. */
function qualifierApplies(qualifier: string, key: string): boolean {
  switch (qualifier) {
    case 'read':
      return key.endsWith('.read');
    case 'move':
      return key.endsWith('.move');
    case 'leave':
      return key === 'hr.leave.approve';
    case 'manager step':
      return true;
    default:
      throw new Error(`SECURITY §3.2 uses a qualifier this test does not know: "${qualifier}"`);
  }
}

function parseMatrix(markdown: string): Map<string, Partial<Record<StaffRoleKey, Scope>>> {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => l.startsWith('### 3.2'));
  const end = lines.findIndex((l, i) => i > start && l.startsWith('### '));
  const matrix = new Map<string, Partial<Record<StaffRoleKey, Scope>>>();
  for (const line of lines.slice(start, end)) {
    if (!line.startsWith('| `')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    const keys = expandKeys(cells[0] ?? '');
    for (const key of keys) matrix.set(key, {});
    cells.slice(1).forEach((cell, i) => {
      if (cell === '–') return;
      const match = /^(all|entity|team|own)(?:\s*\((.+)\))?$/.exec(cell);
      const role = COLUMNS[i];
      if (!match || role === undefined) {
        throw new Error(`SECURITY §3.2 cell "${cell}" in row ${cells[0] ?? ''} cannot be read`);
      }
      const scope = match[1] as Scope;
      for (const key of keys) {
        const qualifier = match[2];
        if (qualifier !== undefined && !qualifierApplies(qualifier, key)) continue;
        const row = matrix.get(key);
        if (row) row[role] = scope;
      }
    });
  }
  return matrix;
}

const document = readFileSync(new URL('../../../docs/07-security.md', import.meta.url), 'utf8');
const fromDocument = parseMatrix(document);

describe('the seeded permission matrix equals docs/07-security.md §3.2', () => {
  it('names exactly the permission keys of the catalogue', () => {
    expect([...fromDocument.keys()].sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it('has the columns of the staff roles', () => {
    expect([...COLUMNS].sort()).toEqual([...STAFF_ROLE_KEYS].sort());
  });

  it.each([...PERMISSION_KEYS])('%s has the documented scope for every role', (key) => {
    expect(STAFF_MATRIX[key]).toEqual(fromDocument.get(key));
  });
});
