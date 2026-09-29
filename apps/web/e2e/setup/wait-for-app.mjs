// Waits until the app answers its health route, or fails with a message and the server's log.
// Usage: node e2e/setup/wait-for-app.mjs <url> [seconds] [log file]
import { existsSync, readFileSync } from 'node:fs';

const [url = 'http://localhost:3000/api/v1/health', seconds = '120', log] = process.argv.slice(2);
const deadline = Date.now() + Number(seconds) * 1000;

while (Date.now() < deadline) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (response.ok) {
      console.log(`the app answers on ${url}`);
      process.exit(0);
    }
  } catch {
    // Not listening yet.
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

console.error(`the app did not answer on ${url} within ${seconds} s`);
if (log !== undefined && existsSync(log)) console.error(readFileSync(log, 'utf8').slice(-8_000));
process.exit(1);
