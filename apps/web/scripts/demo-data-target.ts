// Where the demo data loader (`demo-data.ts`) may write: a database on this machine, or the
// staging project named on the command line. Pure, with no import that reads the environment or
// opens a connection, so the refusal is decided before anything connects.

/** The production Supabase project (packages/db/src/backup-login.ts), refused whatever else holds. */
export const PRODUCTION_PROJECT_REF = 'ifnoytyhnedgiyhxxhhu';

/** Every database address the loader's connections read. */
export const DATABASE_URL_NAMES = [
  'DATABASE_URL',
  'DATABASE_URL_AUTH',
  'DATABASE_URL_READER',
  'DATABASE_URL_OUTBOX',
  'DATABASE_URL_MIGRATOR',
] as const;

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** A Supabase project ref: twenty lower-case letters. */
const PROJECT_REF = /^[a-z]{20}$/;

export type DemoTarget = { kind: 'local' } | { kind: 'staging'; projectRef: string };

/** A target the loader will not write to; the message says why, for the person at the terminal. */
export class DemoTargetRefused extends Error {
  override name = 'DemoTargetRefused';
}

/**
 * The Supabase project an address names: the host `db.<ref>.supabase.co`, or the pooler's user
 * `<role>.<ref>`. Undefined for any other address.
 */
export function supabaseProjectRef(url: URL): string | undefined {
  const direct = /^db\.([a-z]+)\.supabase\.co$/.exec(url.hostname);
  if (direct?.[1] !== undefined) return direct[1];
  if (url.hostname.endsWith('.pooler.supabase.com')) {
    const ref = decodeURIComponent(url.username).split('.')[1];
    if (ref !== undefined && PROJECT_REF.test(ref)) return ref;
  }
  return undefined;
}

/**
 * Decides where the loader may write, or throws `DemoTargetRefused`. Production is refused first:
 * `BOS_ENVIRONMENT=production`, or the production project's ref anywhere in any address. A
 * database on this machine is allowed when every address is local. Anything else must be the
 * staging project: `BOS_ENVIRONMENT=staging`, the project's ref given with `--staging-ref`, and
 * every address on that one project. An address naming more than one host is refused, and
 * `BETTER_AUTH_URL`, which the set-password links point at, must be on this machine for a local
 * target and an https site elsewhere for staging.
 */
export function demoTarget(
  env: Readonly<Record<string, string | undefined>>,
  stagingRef: string | undefined,
): DemoTarget {
  const environment = env.BOS_ENVIRONMENT ?? '';
  if (environment === 'production') {
    throw new DemoTargetRefused('BOS_ENVIRONMENT is production: demo data never goes there.');
  }
  const urls: { name: string; url: URL }[] = [];
  for (const name of DATABASE_URL_NAMES) {
    const raw = env[name];
    if (raw === undefined || raw === '') continue;
    if (raw.toLowerCase().includes(PRODUCTION_PROJECT_REF)) {
      throw new DemoTargetRefused(
        `${name} names the production project: demo data never goes there.`,
      );
    }
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new DemoTargetRefused(`${name} cannot be read as a database address.`);
    }
    // postgres.js reads `a,b` as a list of hosts and tries each in turn, while the URL parser
    // takes it as one name: an address must name one host only.
    if (url.host.includes(',')) {
      throw new DemoTargetRefused(`${name} names more than one host: refusing it.`);
    }
    urls.push({ name, url });
  }
  for (const required of ['DATABASE_URL', 'DATABASE_URL_AUTH'] as const) {
    if (!urls.some((u) => u.name === required)) {
      throw new DemoTargetRefused(`${required} is not set.`);
    }
  }

  // The set-password links point at BETTER_AUTH_URL, which must be the target's own site.
  let site: URL | undefined;
  try {
    site = new URL(env.BETTER_AUTH_URL ?? '');
  } catch {
    site = undefined;
  }

  if (urls.every((u) => LOCAL_HOSTS.has(u.url.hostname))) {
    if (site === undefined || !LOCAL_HOSTS.has(site.hostname)) {
      throw new DemoTargetRefused(
        'BETTER_AUTH_URL is not on this machine, while the database is: the links would point elsewhere.',
      );
    }
    return { kind: 'local' };
  }
  if (urls.some((u) => LOCAL_HOSTS.has(u.url.hostname))) {
    throw new DemoTargetRefused('Some database addresses are on this machine and some are not.');
  }

  if (environment !== 'staging') {
    throw new DemoTargetRefused(
      'The database is not on this machine, and BOS_ENVIRONMENT is not staging: refusing it.',
    );
  }
  if (stagingRef === undefined || !PROJECT_REF.test(stagingRef)) {
    throw new DemoTargetRefused(
      'Name the staging project with --staging-ref <project ref> to write to it.',
    );
  }
  if (stagingRef === PRODUCTION_PROJECT_REF) {
    throw new DemoTargetRefused('--staging-ref names the production project: refusing it.');
  }
  for (const { name, url } of urls) {
    if (supabaseProjectRef(url) !== stagingRef) {
      throw new DemoTargetRefused(`${name} is not an address of the project ${stagingRef}.`);
    }
  }
  if (site?.protocol !== 'https:' || LOCAL_HOSTS.has(site.hostname)) {
    throw new DemoTargetRefused(
      'BETTER_AUTH_URL must be the staging site (https, not this machine), or the links would not open.',
    );
  }
  return { kind: 'staging', projectRef: stagingRef };
}
