// Forwards 127.0.0.1:<port> to <host>:<port>, so a process in a container reaches a neighbour by
// the address `localhost`. Two uses:
// - the Linux snapshot run (`e2e:snap`): the browser in the container opens the app on the host
//   at the address the app knows itself by (BETTER_AUTH_URL), so cookies and origin checks behave
//   as on the host;
// - the CI job: the seed and the app reach the Postgres service as a local database, which they
//   use without TLS (packages/db/src/connection.ts), as they do on a developer's machine.
// Usage: node e2e/setup/forward.mjs [port] [host]; E2E_PORT and E2E_APP_HOST are the defaults.
import { createConnection, createServer } from 'node:net';

const port = Number(process.argv[2] ?? process.env.E2E_PORT ?? '3031');
const host = process.argv[3] ?? process.env.E2E_APP_HOST ?? 'host.docker.internal';

createServer((client) => {
  const upstream = createConnection({ host, port });
  client.pipe(upstream).pipe(client);
  const close = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on('error', close);
  upstream.on('error', close);
}).listen(port, '127.0.0.1');
