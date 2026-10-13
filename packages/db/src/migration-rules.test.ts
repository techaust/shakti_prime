import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../migrations');

/**
 * The rule holds from the first migration after `0129_a1_triage_shadow_rls` (audit 2026-10,
 * DATA-5); the earlier ones are applied and never edited, so they stay as they are.
 */
const RULE_FROM = 130;

/**
 * Every check constraint a migration drops and adds again: drizzle-kit writes a widened list (a
 * new activity type) that way, and the added check scans every row of the table, every partition
 * of `activities` included, under ACCESS EXCLUSIVE until the deploy's transaction commits.
 */
function rewrittenChecks(sql: string): { name: string; notValid: boolean }[] {
  const dropped = new Set(
    [...sql.matchAll(/DROP CONSTRAINT (?:IF EXISTS )?"?([a-z0-9_]+)"?/gi)].map((m) => m[1]),
  );
  return [...sql.matchAll(/ADD CONSTRAINT "?([a-z0-9_]+)"? CHECK \(([\s\S]*?)(?:;|-->)/gi)]
    .filter((m) => dropped.has(m[1]))
    .map((m) => ({
      name: m[1] ?? '',
      notValid: /\)\s*NOT VALID\s*$/i.test(m[0].replace(/(;|-->)$/, '')),
    }));
}

describe('the migrations keep the deploy short (audit 2026-10, DATA-5)', () => {
  it('add a check they drop and add again NOT VALID: a widening needs no scan, a change is validated after the deploy', () => {
    const offending: string[] = [];
    for (const file of readdirSync(migrations)
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      const tag = file.replace(/\.sql$/, '');
      if (Number(tag.slice(0, 4)) < RULE_FROM) continue;
      const sql = readFileSync(join(migrations, file), 'utf8');
      for (const check of rewrittenChecks(sql)) {
        if (!check.notValid) offending.push(`${tag}: ${check.name}`);
      }
    }
    expect(offending).toEqual([]);
  });

  it('finds a widening written whole, and passes one written NOT VALID', () => {
    const whole = `ALTER TABLE "activities" DROP CONSTRAINT "activities_type_check";--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_type_check" CHECK ("type" in ('a', 'b'));`;
    expect(rewrittenChecks(whole)).toEqual([{ name: 'activities_type_check', notValid: false }]);
    expect(rewrittenChecks(whole.replace("'b'));", "'b')) NOT VALID;"))).toEqual([
      { name: 'activities_type_check', notValid: true },
    ]);
    // A check added for the first time is not a widening.
    expect(rewrittenChecks(`ALTER TABLE "x" ADD CONSTRAINT "x_check" CHECK (a > 0);`)).toEqual([]);
  });
});
