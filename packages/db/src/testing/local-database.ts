const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * The suites migrate, seed, disable an append-only trigger and leave test users behind, so they
 * refuse a database that is not on this machine (AUDIT M14). CI's service container is local too.
 * `ALLOW_REMOTE_TEST_DB=1` is the deliberate override.
 */
export function assertLocalDatabase(
  url: string,
  allowRemote = process.env.ALLOW_REMOTE_TEST_DB === '1',
): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('the test database address cannot be read; refusing to run the suites');
  }
  if (!LOCAL_HOSTS.has(host) && !allowRemote) {
    throw new Error(
      `the suites run only against a local database; refusing ${host}. Set ALLOW_REMOTE_TEST_DB=1 to override.`,
    );
  }
}
