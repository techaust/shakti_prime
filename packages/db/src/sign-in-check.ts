// Signs in to a hosted database with the address in SIGN_IN_URL, over TLS checked against the CA in
// SIGN_IN_CA, and prints who it signed in as and how many tables the public schema holds. The
// owner's production secret scripts run it (tools/secrets/production-lib.ps1, deploy.md §1 step
// 4 d) to check the database password before it is stored. Prints no address or password; on
// failure prints only the error's code. Node 24 runs this file as it is, so it imports only
// `postgres`.
import postgres from 'postgres';

const url = process.env.SIGN_IN_URL ?? '';
const ca = process.env.SIGN_IN_CA ?? '';
if (url === '' || ca === '') {
  process.stderr.write('set SIGN_IN_URL and SIGN_IN_CA first\n');
  process.exit(1);
}

const sql = postgres(url, {
  ssl: { ca, rejectUnauthorized: true },
  max: 1,
  prepare: false,
  connect_timeout: 15,
  onnotice: () => undefined,
});
try {
  const [row] = await sql<{ user: string; tables: number }[]>`
    select current_user as "user",
           (select count(*)::int from pg_tables where schemaname = 'public') as tables`;
  process.stdout.write(JSON.stringify(row));
  await sql.end({ timeout: 5 });
} catch (error) {
  const code = (error as { code?: unknown }).code;
  process.stderr.write(`sign-in failed: ${typeof code === 'string' ? code : 'unknown'}\n`);
  await sql.end({ timeout: 1 }).catch(() => undefined);
  process.exit(1);
}
