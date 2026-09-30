// Waits until the app answers its health route, or fails with a message and the server's log.
// Usage: node e2e/setup/wait-for-app.mjs <url> [seconds] [log file]
import { existsSync, readFileSync } from 'node:fs';

const [url = 'http://localhost:3000/api/v1/health', seconds = '120', log] = process.argv.slice(2);
const deadline = Date.now() + Number(seconds) * 1000;

async function answers() {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return response.ok;
  } catch {
    return false; // Not listening yet.
  }
}

let ready = false;
while (!ready && Date.now() < deadline) {
  ready = await answers();
  if (!ready) await new Promise((resolve) => setTimeout(resolve, 1_000));
}

if (ready) {
  console.log(`the app answers on ${url}`);
} else {
  console.error(`the app did not answer on ${url} within ${seconds} s`);
  if (log !== undefined && existsSync(log)) console.error(readFileSync(log, 'utf8').slice(-8_000));
  // Set, not exit: leaving while a request's socket closes trips libuv on Windows.
  process.exitCode = 1;
}
