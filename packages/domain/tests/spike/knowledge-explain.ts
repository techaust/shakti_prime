// Knowledge Vault search and list plans (docs/03-roadmap-appendix/phase1.md §8.4, brief K1): `pnpm
// spike:knowledge`. Fills the local database with made-up vault files (titles `EXPLK file …`) and
// 20,000 made-up passages with random unit embeddings, spread over the four companies and the
// group and over the three sensitivities (70% staff, 20% management, 10% Executive), then prints
// `EXPLAIN (ANALYZE, BUFFERS)` of the search's own statement under the policies as a tele-caller,
// a General Manager and an Executive (with the iterative scan on, as the search runs it, and once
// without it for the tele-caller, to show the shortfall it prevents), and of the vault list as an
// Executive; then times the search through `executeQuery`. Everything it made is removed at the
// end unless `--keep` is given. Local database only (prepareDatabase refuses any other host). Not
// part of CI; it lives under tests/ for the testing helpers.
import { newId, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  prepareDatabase,
} from '@shakti/db/testing';
import { sql, type SQL } from 'drizzle-orm';
import { writeFile } from 'node:fs/promises';
import { executeQuery } from '../../src/command/execute';
import { jsonLogger } from '../../src/ports/logger';
import {
  ITERATIVE_SCAN,
  knowledgeListQuery,
  knowledgeSearchSql,
  searchKnowledge,
} from '../../src/queries/knowledge/vault';

const args = process.argv.slice(2);
const option = (name: string, fallback: number): number => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : Number(args[at + 1]);
};
const FILES = option('files', 400);
const CHUNKS = option('chunks', 20_000);
const RUNS = option('runs', 50);
const KEEP = args.includes('--keep');
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : undefined;

let output = '';
const print = (text: string) => {
  output += text;
  process.stdout.write(text);
};

/** A random unit vector of 1,024 numbers as pgvector text. */
function randomVector(): string {
  const v = Array.from({ length: 1024 }, () => Math.random() * 2 - 1);
  const length = Math.hypot(...v);
  return `[${v.map((x) => (x / length).toFixed(6)).join(',')}]`;
}

async function cleanUp(): Promise<void> {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`delete from knowledge_chunks where knowledge_file_id in
                 (select id from knowledge_files where title like 'EXPLK file %')`;
      const files = await tx<{ file_id: string }[]>`
        delete from knowledge_files where title like 'EXPLK file %' returning file_id`;
      await tx`delete from files where id = any(${files.map((f) => f.file_id)})`;
    }),
  );
}

async function seed(owner: string): Promise<void> {
  const started = Date.now();
  const files: { id: string; entity: number | null; sensitivity: string }[] = [];
  await asMigrator((m) =>
    m.begin(async (tx) => {
      for (let i = 0; i < FILES; i += 1) {
        const entity = i % 5 === 4 ? null : (i % 5) + 1;
        const roll = i % 10;
        const sensitivity = roll < 7 ? 'staff_ai_ok' : roll < 9 ? 'management' : 'exec_only';
        const upload = newId();
        const id = newId();
        await tx`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
          values (${upload}, ${entity ?? 1}, 'knowledge', 'spike', ${`spike/${upload}.pdf`}, 'spike.pdf', 'application/pdf', 1, ${'e'.repeat(64)}, 'ready', ${owner})`;
        await tx`insert into knowledge_files (id, entity_id, file_id, title, sensitivity, source_type, state, chunks, indexed_at, created_by)
          values (${id}, ${entity}, ${upload}, ${`EXPLK file ${String(i)}`}, ${sensitivity}, 'pdf', 'indexed', ${CHUNKS / FILES}, now(), ${owner})`;
        files.push({ id, entity, sensitivity });
      }
    }),
  );
  const perFile = Math.ceil(CHUNKS / FILES);
  for (const file of files) {
    await asMigrator(
      (
        m,
      ) => m`insert into knowledge_chunks (id, knowledge_file_id, entity_id, sensitivity, position, chunk_text, embedding)
        select gen_random_uuid(), ${file.id}, ${file.entity}, ${file.sensitivity}, p,
               'made-up passage for the vault spike', ${randomVector()}::vector
          from generate_series(0, ${perFile - 1}) p`,
    );
  }
  print(
    `seeded ${String(FILES)} files and ${String(files.length * perFile)} passages in ${String(Math.round((Date.now() - started) / 1000))} s\n`,
  );
}

async function explain(label: string, who: Principal, statement: SQL, scan = true): Promise<void> {
  const plan = await asPrincipal(who, async ({ tx }) => {
    if (scan) await tx.execute(ITERATIVE_SCAN);
    const rows = (await tx.execute(
      sql`explain (analyze, buffers, costs off) ${statement}`,
    )) as unknown as Record<string, string>[];
    return rows.map((r) => Object.values(r)[0]).join('\n');
  });
  print(`\n=== ${label} ===\n${plan}\n`);
}

async function found(who: Principal, query: string, scan: boolean): Promise<number> {
  return asPrincipal(who, async ({ tx }) => {
    if (scan) await tx.execute(ITERATIVE_SCAN);
    const rows = (await tx.execute(knowledgeSearchSql(query, 8))) as unknown as unknown[];
    return rows.length;
  });
}

async function time(who: Principal, label: string): Promise<void> {
  const durations: number[] = [];
  const vector = Array.from({ length: 1024 }, () => Math.random());
  for (let i = 0; i < RUNS + 5; i += 1) {
    const started = performance.now();
    await executeQuery(who, {}, (ctx) => searchKnowledge(ctx, vector), {
      name: 'spike.searchKnowledge',
      logger: { log: () => undefined },
    });
    if (i >= 5) durations.push(performance.now() - started);
  }
  durations.sort((a, b) => a - b);
  const at = (p: number) =>
    durations[Math.min(durations.length - 1, Math.floor(p * durations.length))] ?? 0;
  print(
    `${label}: p50 ${at(0.5).toFixed(1)} ms, p95 ${at(0.95).toFixed(1)} ms over ${String(RUNS)} runs\n`,
  );
}

async function main(): Promise<void> {
  await prepareDatabase();
  await cleanUp();
  const owner = await createTestPrincipal('executive');
  await seed(owner.id);
  await asMigrator((m) => m`analyze knowledge_chunks, knowledge_files`);
  const caller = await createTestPrincipal('tele_caller_cc', [1]);
  const gm = await createTestPrincipal('general_manager', [1]);
  const executive = await createTestPrincipal('executive');
  const query = randomVector();

  print('\nPassages found for one question (of 8 asked):\n');
  print(`tele-caller, company 1, iterative scan on: ${String(await found(caller, query, true))}\n`);
  print(
    `tele-caller, company 1, iterative scan off: ${String(await found(caller, query, false))}\n`,
  );

  await explain('search, tele-caller, company 1', caller, knowledgeSearchSql(query, 8));
  await explain(
    'search, tele-caller, company 1, without the iterative scan',
    caller,
    knowledgeSearchSql(query, 8),
    false,
  );
  await explain('search, General Manager, company 1', gm, knowledgeSearchSql(query, 8));
  await explain('search, Executive, all companies', executive, knowledgeSearchSql(query, 8));
  const list = await asPrincipal(executive, (ctx) => {
    const built = knowledgeListQuery(ctx, undefined).toSQL();
    let text = built.sql;
    for (let i = built.params.length; i >= 1; i -= 1) {
      const value = built.params[i - 1];
      text = text.replaceAll(
        `$${String(i)}`,
        typeof value === 'number' ? String(value) : `'${String(value)}'`,
      );
    }
    return Promise.resolve(text);
  });
  await explain('vault list, Executive, all companies', executive, sql.raw(list), false);

  print('\nSearch timed through executeQuery (the embedding call is not included):\n');
  await time(caller, 'tele-caller, company 1');
  await time(gm, 'General Manager, company 1');
  await time(executive, 'Executive, all companies');

  if (OUT !== undefined) await writeFile(OUT, output);
  if (!KEEP) await cleanUp();
  await closeDb();
}

main().catch(async (error: unknown) => {
  jsonLogger().log('error', 'spike.knowledge_failed', { error });
  await closeDb();
  process.exitCode = 1;
});
