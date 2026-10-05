// Prepares the database for the journeys, on the host: migrates and seeds, then makes the people
// of `e2e/support/users.ts` idempotently and writes what the specs need to `e2e/.auth/users.json`.
// Run by `pnpm --filter web e2e:seed` (and so by `e2e` and `e2e:snap`) before the Playwright runner.
import { newId } from '@shakti/contracts';
import { closeAuthDb } from '@shakti/db/auth';
import { asMigrator, closeDb, prepareDatabase, principalFor, roleId } from '@shakti/db/testing';
import {
  createImportJob,
  createLead,
  executeCommand,
  memoryKeyValue,
  memoryMailer,
  parseImportFile,
  setReferralPartner,
} from '@shakti/domain';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAuth } from '../../src/auth/create-auth';
import { fileStore } from '../../src/files/store';
import { writePrintPages } from './print-pages';
import { ensureQuoteJourneys } from './quotes';
import { totpCode } from '../support/totp';
import {
  AUTH_DIR,
  E2E_PASSWORD,
  emailFor,
  PROJECTS,
  REFERRAL_PARTNER,
  SIGNED_IN_ROLES,
  SEND_AGAIN_COMPANY,
  SNAPSHOT_COMPANY,
  SNAPSHOT_HELD_BACK_ID,
  SNAPSHOT_IMPORT_FILE,
  SNAPSHOT_LEADS,
  type ProjectName,
  type SeededUsers,
} from '../support/users';

type RoleKey = Parameters<typeof roleId>[0];

// The breached-password range service is the one outside call these flows make; the test phrase
// is not in it, and the seed never depends on the network.
// A seed that stops making progress fails with the step it was on, instead of holding a CI job
// until its own time runs out.
const SEED_LIMIT_MS = 5 * 60_000;
const started = Date.now();
let step = 'starting';
const watchdog = setTimeout(() => {
  console.error(`e2e seed: no end after ${String(SEED_LIMIT_MS / 60_000)} minutes, at: ${step}`);
  process.exit(1);
}, SEED_LIMIT_MS);
function progress(next: string): void {
  step = next;
  console.warn(`e2e seed: ${next} (${String(Math.round((Date.now() - started) / 1000))} s)`);
}

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
      // Every run starts from the default look and name, so the screenshots compare like with like.
      await tx`update users set theme = 'system', contrast = 'standard', name = ${name}
               where id = ${id}`;
      await tx`update principals set display_name = ${name} where id = ${id}`;
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

/**
 * A lead in one company, made once, for the list and the company switcher journeys. It is found
 * again by what only the seed writes: its owner, a person of `users.ts` whom no other suite ever
 * makes, in that company, with that contact name. A name alone would match a customer another
 * suite made on the same database (the security suite's own "Kamla Devi"), and the lead would
 * never be made.
 */
async function ensureLead(
  owner: { id: string; roleKey: RoleKey; entityIds: readonly number[] },
  entityId: number,
  name: string,
  phone: string,
): Promise<void> {
  const [found] = await asMigrator(
    (m) => m<{ n: number }[]>`
      select count(*)::int as n
        from opportunities o
        join account_contacts ac on ac.account_id = o.account_id
        join contacts c on c.id = ac.contact_id
       where o.owner_id = ${owner.id} and o.entity_id = ${entityId} and c.name = ${name}`,
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

/**
 * An update held back after ten tries, as the publisher leaves one (Integration health). Written
 * as the table owner: no request role writes the outbox's delivery columns. The type is one no
 * worker listens to, so a replay is marked delivered without being sent.
 */
async function holdBackUpdate(id: string, entityId: number, heldAt: string): Promise<void> {
  await asMigrator(
    (m) => m`insert into outbox_events (id, entity_id, type, aggregate_type, aggregate_id,
                                        payload_json, attempts, last_error, dead_lettered_at,
                                        created_at)
             values (${id}, ${entityId}, 'admin.user.reactivated', 'user', ${newId()},
                     '{"v": 1}'::jsonb, 10, 'worker_failed', ${heldAt}::timestamptz,
                     ${heldAt}::timestamptz - interval '4 hours')
             on conflict (id) do nothing`,
  );
}

/**
 * The referral partner of `users.ts`, made once in company 1 by the seed's Executive as a customer
 * of the kind Referral partner, with its code accepted on new leads. Found again by its code.
 */
async function ensureReferralPartner(executiveId: string): Promise<void> {
  const [found] = await asMigrator(
    (m) => m<{ n: number }[]>`select count(*)::int as n from referral_partners
                              where lower(code) = lower(${REFERRAL_PARTNER.code})`,
  );
  if ((found?.n ?? 0) > 0) return;
  const executive = principalFor('executive', [1, 2, 3, 4], { id: executiveId });
  const lead = await executeCommand(executive, { entityIds: [1] }, createLead, {
    entityId: 1,
    pipelineKey: 'farmer_pumps',
    contact: { name: REFERRAL_PARTNER.name, phone: REFERRAL_PARTNER.phone },
    account: { type: 'referral_partner' },
  });
  await executeCommand(executive, {}, setReferralPartner, {
    accountId: lead.account.id,
    code: REFERRAL_PARTNER.code,
    isActive: true,
  });
}

/** One import job in the snapshot company, from a fixed spreadsheet, made once. */
async function ensureSnapshotImport(executiveId: string): Promise<void> {
  // Found again by the seed's Executive, whom no other suite makes, not by the company alone.
  const [found] = await asMigrator(
    (m) => m<{ n: number }[]>`select count(*)::int as n from import_jobs
                              where entity_id = ${SNAPSHOT_COMPANY.entityId}
                                and created_by = ${executiveId}`,
  );
  if ((found?.n ?? 0) > 0) return;
  const store = fileStore();
  if (store === undefined) throw new Error('no local file store for the snapshot import');
  const csv = [
    'Name,Mobile,Village',
    'Sohan Lal Meghwal,98765 40021,Kekri',
    'Laxmi Devi,98765 40022,Sarwar',
  ].join('\n');
  const bytes = new TextEncoder().encode(`${csv}\n`);
  const parsed = await parseImportFile(bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const key = `imports/${String(SNAPSHOT_COMPANY.entityId)}/${sha256}.${parsed.format}`;
  await store.put(key, bytes, 'text/csv');
  await executeCommand(
    principalFor('executive', [1, 2, 3, 4], { id: executiveId }),
    { entityIds: [SNAPSHOT_COMPANY.entityId] },
    createImportJob,
    {
      entityId: SNAPSHOT_COMPANY.entityId,
      kind: 'leads',
      file: {
        name: SNAPSHOT_IMPORT_FILE,
        contentType: 'text/csv',
        size: bytes.length,
        sha256,
        bucket: store.bucket,
        key,
      },
      format: parsed.format,
      columns: parsed.columns,
      rows: parsed.rows,
    },
  );
}

progress('migrating and seeding the database');
await prepareDatabase();

const totpSecrets: Record<string, string> = {};
const ids: Record<string, string> = {};
progress('the people of each role');
for (const role of SIGNED_IN_ROLES) {
  const email = emailFor(role.key);
  const id = await ensureUser(email, role.name, role.roleKey, role.entityIds);
  await setPassword(email);
  if (role.twoFactor) totpSecrets[role.key] = await enrolAuthenticator(id, email);
  ids[role.key] = id;
}

const setPasswordLinks = {} as Record<ProjectName, string>;
const enrolEmails = {} as Record<ProjectName, string>;
const verifyUsers = {} as SeededUsers['verifyUsers'];
const profileUsers = {} as SeededUsers['profileUsers'];
progress('the people of each project');
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

  const profile = emailFor(`profile-${project}`);
  const profileId = await ensureUser(profile, `E2E profile ${project}`, 'accounts', [1]);
  await setPassword(profile);
  profileUsers[project] = { email: profile, secret: await enrolAuthenticator(profileId, profile) };
}

progress('the leads');
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

progress('the referral partner');
await ensureReferralPartner(ids.executive ?? '');

progress('the snapshot company');
// The snapshot company (users.ts): its leads, all the snapshot caller's, and one import.
for (const lead of SNAPSHOT_LEADS) {
  await ensureLead(
    {
      id: ids.snapshotCaller ?? '',
      roleKey: 'tele_caller_cc',
      entityIds: [SNAPSHOT_COMPANY.entityId],
    },
    SNAPSHOT_COMPANY.entityId,
    lead.name,
    lead.phone,
  );
}
await ensureSnapshotImport(ids.executive ?? '');

progress('the quotes');
const quotes = await ensureQuoteJourneys(ids.executive ?? '');

progress('the held-back updates');
// Integration health: one fixed update held back in the snapshot company, and one per project
// for the Send again journey, which sends one back each run.
await holdBackUpdate(SNAPSHOT_HELD_BACK_ID, SNAPSHOT_COMPANY.entityId, '2026-09-01T04:30:00Z');
for (const project of PROJECTS) {
  await holdBackUpdate(newId(), SEND_AGAIN_COMPANY.entityId, new Date().toISOString());
  progress(`a held-back update for ${project}`);
}

mkdirSync(AUTH_DIR, { recursive: true });
const seeded: SeededUsers = {
  totpSecrets,
  setPasswordLinks,
  enrolEmails,
  verifyUsers,
  profileUsers,
  secondCompanyLead,
  quotes,
};
writeFileSync(join(AUTH_DIR, 'users.json'), JSON.stringify(seeded, null, 2));
await writePrintPages();
progress(`${String(SIGNED_IN_ROLES.length)} roles and ${String(PROJECTS.length)} projects ready`);

await closeAuthDb();
await closeDb();
clearTimeout(watchdog);
process.exit(0);
