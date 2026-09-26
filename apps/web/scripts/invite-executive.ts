// Invites the first Executive of an environment and prints the set-password link.
// Usage: pnpm --filter web invite-executive -- --email you@shakti.example --name "Your Name"
import { bootstrapExecutive } from '@shakti/db/bootstrap';
import { consoleMailer, memoryKeyValue } from '@shakti/domain';
import { createAuth } from '../src/auth/create-auth';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const email = arg('email');
const name = arg('name');
if (email === undefined || name === undefined) {
  console.error('usage: invite-executive --email <email> --name <name> [--force]');
  process.exit(1);
}

const userId = await bootstrapExecutive({ email, name, force: process.argv.includes('--force') });
console.log(`created Executive ${userId}`);

const auth = createAuth(
  {
    keyValue: memoryKeyValue(),
    mailer: consoleMailer((line) => {
      console.log(line);
    }),
    fetch: (...args) => fetch(...args),
    now: () => new Date(),
    turnstileSecretKey: '',
  },
  { nextCookies: false },
);
// No headers: an internal call, so the bot check does not apply (see create-auth.ts).
await auth.api.requestPasswordReset({ body: { email, redirectTo: '/set-password' } });
process.exit(0);
