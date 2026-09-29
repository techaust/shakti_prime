// Prepares the database for the journeys, on the host: migrates and seeds, then makes the people
// of `e2e/support/users.ts` idempotently and writes what the specs need to `e2e/.auth/users.json`.
// Run by `pnpm --filter web e2e:seed` (and so by `e2e` and `e2e:snap`) before the Playwright runner.
import { newId } from '@shakti/contracts';
import { closeAuthDb } from '@shakti/db/auth';
import { asMigrator, closeDb, prepareDatabase, principalFor, roleId } from '@shakti/db/testing';
import { createLead, executeCommand, memoryKeyValue, memoryMailer } from '@shakti/domain';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAuth } from '../../src/auth/create-auth';
import { totpCode } from '../support/totp';
import {
  AUTH_DIR,
  E2E_PASSWORD,
  emailFor,
  PROJECTS,
  SIGNED_IN_ROLES,
  type ProjectName,
  type SeededUsers,
} from '../support/users';

type RoleKey = Parameters<typeof roleId>[0];

// The breached-password range service is the one outside call these flows make; the test phrase
// is not in it, and the seed never depends on the network.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = input instanceof Request ? input.url : input.toString();
  if (url.includes('pwnedpasswords')) return Promise.resolve(new Response('', { status: 200 }));
  return realFetch(input, init);
};

const mailer = memoryMailer();
const auth = createAuth(
  {
    keyValue: memoryKeyValue(),
    mailer,
    fetch: globalThis.fetch,
    now: () => new Date(),
    turnstileSecretKey: '',
  },
  { nextCookies: false },
);

/** The person with this email, made when missing; their roles are set to exactly these. */
async function ensureUser(
  email: string,
  name: string,
  roleKey: RoleKey,
  entityIds: readonly number[],
): Promise<string> {
  return asMigrator((m) =>
    m.begin(async (tx) => {
      const [existing] = await tx<{ id: string }[]>`select id from users where email = ${email}`;
      const id = existing?.id ?? newId();
      if (existing === undefined) {
        await tx`insert into principals (id, kind, display_name) values (${id}, 'user', ${name})`;
        await tx`insert into users (id, name, email, status)
                 values (${id}, ${name}, ${email}, 'invited')`;
      }
      await tx`delete from user_entity_roles where user_id = ${id}`;
      for (const entityId of entityIds) {
        await tx`insert into user_entity_roles (id, user_id, entity_id, role_id)
                 values (${newId()}, ${id}, ${entityId}, ${roleId(roleKey)})`;
      }
      return id;
    }),
  );
}

/** A set-password link for this person, as the invite mail carries it. */
async function setPasswordLink(email: string): Promise<string> {
  await auth.api.requestPasswordReset({ body: { email, redirectTo: '/set-password' } });
  const mail = mailer.sent.findLast((m) => m.to === email);
  const link = /https?:\/\/\S+reset-password\/\S+/.exec(mail?.text ?? '')?.[0];
  if (link === undefined) throw new Error(`no set-password link was sent to ${email}`);
  return link;
}

async function setPassword(email: string): Promise<void> {
  const link = await setPasswordLink(email);
  const token = /reset-password\/([^?\s]+)/.exec(link)?.[1] ?? '';
  await auth.api.resetPassword({ body: { newPassword: E2E_PASSWORD, token } });
}

async function removeAuthenticator(userId: string): Promise<void> {
  await asMigrator(async (m) => {
    await m`delete from user_two_factor where user_id = ${userId}`;
    await m`update users set two_factor_enabled = false where id = ${userId}`;
  });
}

/** Removes any earlier authenticator app and sets up a fresh one; answers its secret. */
async function enrolAuthenticator(userId: string, email: string): Promise<string> {
  await removeAuthenticator(userId);
  const signedIn = await auth.api.signInEmail({
    body: { email, password: E2E_PASSWORD },
    returnHeaders: true,
  });
  const cookie = signedIn.headers
    .getSetCookie()
    .map((c) => c.split(';')[0] ?? '')
    .join('; ');
  const headers = new Headers({ cookie });
  const enrol = await auth.api.enableTwoFactor({
    body: { password: E2E_PASSWORD, method: 'totp' },
    headers,
  });
  if (enrol.method !== 'totp') throw new Error('expected an authenticator app enrolment');
  const secret = new URL(enrol.totpURI).searchParams.get('secret') ?? '';
  await auth.api.verifyTOTP({ body: { code: totpCode(secret) }, headers });
  return secret;
}

/** A lead in one company, made once, for the list and the company switcher journeys. */
async function ensureLead(
  owner: { id: string; roleKey: RoleKey; entityIds: readonly number[] },
  entityId: number,
  name: string,
  phone: string,
): Promise<void> {
  const [found] = await asMigrator(
    (m) => m<{ n: number }[]>`select count(*)::int as n from contacts where name = ${name}`,
  );
  if ((found?.n ?? 0) > 0) return;
  const principal = principalFor(owner.roleKey, owner.entityIds, { id: owner.id });
  await executeCommand(principal, {}, createLead, {
    entityId,
    pipelineKey: 'farmer_pumps',
    contact: { name, phone },
    account: { type: 'farm' },
    site: { type: 'borewell', village: 'Kishangarh', pin: '305801' },
    consent: { channel: 'whatsapp', purpose: 'service', source: 'walk_in_form', textVersion: 'v1' },
    sourceCode: 'walk_in',
  });
}

await prepareDatabase();

const totpSecrets: Record<string, string> = {};
const ids: Record<string, string> = {};
for (const role of SIGNED_IN_ROLES) {
  const email = emailFor(role.key);
  const id = await ensureUser(email, `E2E ${role.key}`, role.roleKey, role.entityIds);
  await setPassword(email);
  if (role.twoFactor) totpSecrets[role.key] = await enrolAuthenticator(id, email);
  ids[role.key] = id;
}

const setPasswordLinks = {} as Record<ProjectName, string>;
const enrolEmails = {} as Record<ProjectName, string>;
const verifyUsers = {} as SeededUsers['verifyUsers'];
for (const project of PROJECTS) {
  const invited = emailFor(`invited-${project}`);
  const invitedId = await ensureUser(invited, `E2E invited ${project}`, 'tele_caller_cc', [1]);
  // Invited again, so the link opens the first-password screen on every run.
  await asMigrator((m) => m`update users set status = 'invited' where id = ${invitedId}`);
  setPasswordLinks[project] = await setPasswordLink(invited);

  const enrol = emailFor(`enrol-${project}`);
  const enrolId = await ensureUser(enrol, `E2E enrol ${project}`, 'general_manager', [1]);
  await setPassword(enrol);
  await removeAuthenticator(enrolId);
  enrolEmails[project] = enrol;

  const verify = emailFor(`verify-${project}`);
  const verifyId = await ensureUser(verify, `E2E verify ${project}`, 'accounts', [1]);
  await setPassword(verify);
  verifyUsers[project] = { email: verify, secret: await enrolAuthenticator(verifyId, verify) };
}

const secondCompanyLead = 'Ramesh Choudhary';
// Fixed numbers, made once: the list shows the same rows on every run.
await ensureLead(
  { id: ids.teleCaller ?? '', roleKey: 'tele_caller_cc', entityIds: [1] },
  1,
  'Kavita Saini',
  '98765 40001',
);
await ensureLead(
  { id: ids.teamLead ?? '', roleKey: 'sales_team_lead', entityIds: [1, 2] },
  1,
  'Pooja Gurjar',
  '98765 40003',
);
await ensureLead(
  { id: ids.executive ?? '', roleKey: 'executive', entityIds: [1, 2, 3, 4] },
  2,
  secondCompanyLead,
  '98765 40002',
);

mkdirSync(AUTH_DIR, { recursive: true });
const seeded: SeededUsers = {
  totpSecrets,
  setPasswordLinks,
  enrolEmails,
  verifyUsers,
  secondCompanyLead,
};
writeFileSync(join(AUTH_DIR, 'users.json'), JSON.stringify(seeded, null, 2));
console.warn(
  `e2e seed: ${String(SIGNED_IN_ROLES.length)} roles and ${String(PROJECTS.length)} projects ready`,
);

await closeAuthDb();
await closeDb();
process.exit(0);
