// renumber-migrations.mjs <baseRef> <branchRef> (docs/runbooks/slice-integration.md)
// Run from a worktree root while (or after) merging <baseRef> into the slice branch.
// Moves the branch's own migrations after the base's last one, keeps their SQL verbatim,
// restores the base's journal and snapshots, chains fresh snapshot ids for the branch's
// intermediate migrations and lets drizzle-kit write the last snapshot from the schema.
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [baseRef, branchRef] = process.argv.slice(2);
if (!baseRef || !branchRef) throw new Error('usage: renumber-migrations.mjs <baseRef> <branchRef>');
const dir = 'packages/db/migrations';
const meta = `${dir}/meta`;
const git = (c) => execSync(`git ${c}`, { encoding: 'utf8', maxBuffer: 1 << 28 });
const show = (ref, p) => git(`show ${ref}:${p}`);
const pad = (n) => String(n).padStart(4, '0');

const base = JSON.parse(show(baseRef, `${meta}/_journal.json`));
const branch = JSON.parse(show(branchRef, `${meta}/_journal.json`));
const baseTags = new Set(base.entries.map((e) => e.tag));
const own = branch.entries.filter((e) => !baseTags.has(e.tag));
if (own.length === 0) {
  console.log('no branch-only migrations');
  process.exit(0);
}
const baseLast = base.entries.at(-1).idx;
console.log(`base last ${baseLast}; branch-only: ${own.map((e) => e.tag).join(', ')}`);

// Base files win: journal, every base snapshot, every base SQL file.
git(`checkout ${baseRef} -- ${meta}/_journal.json`);
for (const e of base.entries) {
  git(`checkout ${baseRef} -- ${meta}/${pad(e.idx)}_snapshot.json ${dir}/${e.tag}.sql`);
}
// Drop every snapshot and SQL file past the base's last migration (an earlier run's leftovers too).
for (const f of fs.readdirSync(meta)) {
  if (/^\d{4}_snapshot\.json$/.test(f) && Number(f.slice(0, 4)) > baseLast)
    fs.rmSync(`${meta}/${f}`);
}
for (const f of fs.readdirSync(dir)) {
  if (/^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) > baseLast) fs.rmSync(`${dir}/${f}`);
}
// Drop the branch's old files that are not base files.
for (const e of own) {
  const sql = `${dir}/${e.tag}.sql`;
  if (fs.existsSync(sql)) fs.rmSync(sql);
  const snap = `${meta}/${pad(e.idx)}_snapshot.json`;
  if (!base.entries.some((b) => b.idx === e.idx) && fs.existsSync(snap)) fs.rmSync(snap);
}

const journal = structuredClone(base);
let prev = JSON.parse(fs.readFileSync(`${meta}/${pad(baseLast)}_snapshot.json`, 'utf8'));
const placed = own.map((e, i) => {
  const idx = baseLast + 1 + i;
  // drizzle's migrator skips a migration whose `when` is older than the last one applied, so a
  // moved migration always comes after the base's last one.
  const when = Math.max(e.when, base.entries.at(-1).when + 1000 * (i + 1));
  return { ...e, idx, when, tag: pad(idx) + e.tag.slice(4), oldTag: e.tag };
});
for (const [i, e] of placed.entries()) {
  fs.writeFileSync(`${dir}/${e.tag}.sql`, show(branchRef, `${dir}/${e.oldTag}.sql`));
  if (i === placed.length - 1) break;
  const snap = { ...prev, id: randomUUID(), prevId: prev.id };
  fs.writeFileSync(`${meta}/${pad(e.idx)}_snapshot.json`, JSON.stringify(snap, null, 2));
  journal.entries.push({
    idx: e.idx,
    version: e.version,
    when: e.when,
    tag: e.tag,
    breakpoints: e.breakpoints,
  });
  prev = snap;
}
fs.writeFileSync(`${meta}/_journal.json`, JSON.stringify(journal, null, 2));

// Let drizzle-kit write the last snapshot from the schema (the full branch diff).
const last = placed.at(-1);
const lastSql = fs.readFileSync(`${dir}/${last.tag}.sql`, 'utf8');
fs.rmSync(`${dir}/${last.tag}.sql`);
const out = execSync('pnpm exec drizzle-kit generate --name renumber_tmp', {
  cwd: 'packages/db',
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
const generated = `${dir}/${pad(last.idx)}_renumber_tmp.sql`;
const after = JSON.parse(fs.readFileSync(`${meta}/_journal.json`, 'utf8'));
if (fs.existsSync(generated)) {
  fs.rmSync(generated);
  after.entries.at(-1).tag = last.tag;
  after.entries.at(-1).when = last.when;
  after.entries.at(-1).breakpoints = last.breakpoints;
} else {
  console.log('drizzle-kit found no schema change:', out.trim().split('\n').at(-1));
  const snap = { ...prev, id: randomUUID(), prevId: prev.id };
  fs.writeFileSync(`${meta}/${pad(last.idx)}_snapshot.json`, JSON.stringify(snap, null, 2));
  after.entries.push({
    idx: last.idx,
    version: last.version,
    when: last.when,
    tag: last.tag,
    breakpoints: last.breakpoints,
  });
}
fs.writeFileSync(`${meta}/_journal.json`, JSON.stringify(after, null, 2));
fs.writeFileSync(`${dir}/${last.tag}.sql`, lastSql);
for (const e of placed) console.log(`${e.oldTag} -> ${e.tag}`);
console.log('check: pnpm db:generate must report no changes; then git add', path.normalize(dir));
