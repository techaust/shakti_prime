// The demo data of the screen review (docs/13-client-packs/wireframe-review.md §1a), on a local
// database or the staging project only, never production.
// Usage, from the repository root:
//   pnpm --filter web exec tsx scripts/demo-data.ts load [--email-domain <domain>] [--staging-ref <ref>]
//   pnpm --filter web exec tsx scripts/demo-data.ts remove [--email-domain <domain>] [--staging-ref <ref>]
// `load` prints each demo account with its role and set-password link; run again, it changes
// nothing. `remove` takes the set off and closes every demo account. Both act as the first
// Executive, through the domain commands only.
//
// The environment comes from the repository's .env, as for every script: the database package
// loads it when imported and opens no connection before the first query, so the target is
// decided below before anything connects.
import { memoryMailer } from '@shakti/domain';
import { createAuth } from '../src/auth/create-auth';
import { defaultAuthDeps } from '../src/auth/deps';
import { firstExecutive } from '../src/auth/operator-principal';
import { invalidatePrincipal } from '../src/auth/session-principal';
import {
  DEMO_CODE,
  DEMO_MARK,
  DemoAlreadyRemoved,
  demoSet,
  loadDemoData,
  removeDemoData,
} from './demo-data-loader';
import { DemoTargetRefused, demoTarget, type DemoTarget } from './demo-data-target';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const action = process.argv[2];
if (action !== 'load' && action !== 'remove') {
  console.error(
    'usage: demo-data.ts load|remove [--email-domain <domain>] [--staging-ref <project ref>]',
  );
  process.exit(1);
}

let target: DemoTarget;
try {
  target = demoTarget(process.env, arg('staging-ref'));
} catch (error) {
  if (error instanceof DemoTargetRefused) {
    console.error(`refused: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
console.log(
  target.kind === 'local'
    ? 'target: the database on this machine'
    : `target: the staging project ${target.projectRef}`,
);

const emailDomain = (arg('email-domain') ?? 'example.com').trim().toLowerCase();
if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(emailDomain)) {
  console.error(`not an email domain: ${emailDomain}`);
  process.exit(1);
}

const operator = await firstExecutive();
if (operator.kind === 'none') {
  console.error(
    'There is no active Executive on this database. Invite one first (invite-executive).',
  );
  process.exit(1);
}
if (operator.kind === 'not_ready') {
  console.error(
    `The Executive ${operator.name} has not finished signing in (the authenticator app); the demo data waits for that.`,
  );
  process.exit(1);
}
console.log(`acting as: ${operator.name}`);

const deps = defaultAuthDeps();
const mailer = memoryMailer();
// The same set-password flow as Admin › Team members: the auth module makes the link and its
// message, which is caught here rather than mailed, so the link is printed beside the role.
const auth = createAuth({ ...deps, mailer }, { nextCookies: false });
async function issueLink(email: string): Promise<string> {
  const before = mailer.sent.length;
  // No headers: an internal call, so the bot check does not apply (see create-auth.ts).
  await auth.api.requestPasswordReset({ body: { email, redirectTo: '/set-password' } });
  const link = mailer.sent
    .slice(before)
    .find((m) => m.to === email)
    ?.text.match(/https?:\/\/\S+/)?.[0];
  if (link === undefined) throw new Error(`no set-password link was made for ${email}`);
  return link;
}

try {
  const options = {
    operator: operator.principal,
    set: demoSet(),
    emailDomain,
    issueLink,
    forget: (userId: string) => invalidatePrincipal(deps.keyValue, userId),
    log: (line: string) => {
      console.log(line);
    },
  };
  const summary = action === 'load' ? await loadDemoData(options) : await removeDemoData(options);
  console.log(`${String(summary.writes)} changes made`);
  for (const account of summary.accounts) {
    const state =
      action === 'remove'
        ? 'closed'
        : (account.link ?? 'already invited: the person uses the link printed before');
    console.log(`${account.roleKey}  ${account.email}  ${state}`);
  }
  console.log(
    action === 'load'
      ? `Every record of the set is marked ${DEMO_MARK}; item and kit codes start ${DEMO_CODE}.`
      : 'Customers, the timeline, the price change log and the Activity log keep their demo rows.',
  );
} catch (error) {
  if (error instanceof DemoAlreadyRemoved) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
process.exit(0);
