// Runs inside the Linux snapshot container: forwards localhost:<port> to the app on the host, so
// the browser in the container opens the same address the app knows itself by (BETTER_AUTH_URL),
// and its cookies and origin checks behave as they do on the host.
import { createConnection, createServer } from 'node:net';

const port = Number(process.env.E2E_PORT ?? '3031');
const host = process.env.E2E_APP_HOST ?? 'host.docker.internal';

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
