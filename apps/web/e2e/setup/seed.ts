// Prepares the database for the journeys, on the host: migrates and seeds, then makes the people
// of `e2e/support/users.ts` idempotently and writes what the specs need to `e2e/.auth/users.json`.
// Run by `pnpm --filter web e2e:seed` (and so by `e2e` and `e2e:snap`) before the Playwright runner.
import { AGENT_PRINCIPAL_IDS, newId, SYSTEM_WORKERS_PRINCIPAL_ID } from '@shakti/contracts';
import { closeAuthDb } from '@shakti/db/auth';
import {
  asMigrator,
  closeDb,
  createReadyImportFile,
  prepareDatabase,
  principalFor,
  roleId,
} from '@shakti/db/testing';
import {
  addKnowledgeFile,
  createAiProvider,
  createImportJob,
  createLead,
  executeCommand,
  fakeModelTransport,
  indexKnowledgeFile,
  memoryKeyValue,
  memoryLogger,
  memoryMailer,
  parseImportFile,
  setReferralPartner,
} from '@shakti/domain';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAuth } from '../../src/auth/create-auth';
import { fileStore } from '../../src/files/store';
import { readWordText } from '../../src/workers/knowledge/read-word';
import { wordDocument } from '../support/docx';
import { writePrintPages } from './print-pages';
import { ensureQuoteJourneys } from './quotes';
import { suggestFollowUp } from './stand-in-agent';
import { totpCode } from '../support/totp';
import {
  AUTH_DIR,
  E2E_PASSWORD,
  emailFor,
  INBOX_SUGGESTIONS,
  KILL_SWITCH,
  PROJECTS,
  REFERRAL_PARTNER,
  SIGNED_IN_ROLES,
  SEND_AGAIN_COMPANY,
  SNAPSHOT_COMPANY,
  SNAPSHOT_HELD_BACK_ID,
  SNAPSHOT_IMPORT_FILE,
  SNAPSHOT_LEADS,
  SNAPSHOT_SUGGESTIONS,
  SNAPSHOT_VAULT,
  type ProjectName,
  type SeededUsers,
} from '../support/users';

type RoleKey = Parameters<typeof roleId>[0];

/** The team of company 1 that the tele-caller and the team lead share. */
const CALLING_TEAM = 'Tele-calling team';

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

/** The lead the seed made for this owner in this company, by its contact's name. */
async function leadId(ownerId: string, entityId: number, name: string): Promise<string> {
  const [found] = await asMigrator(
    (m) => m<{ id: string }[]>`
      select o.id
        from opportunities o
        join account_contacts ac on ac.account_id = o.account_id
        join contacts c on c.id = ac.contact_id
       where o.owner_id = ${ownerId} and o.entity_id = ${entityId} and c.name = ${name}
       order by o.created_at
       limit 1`,
  );
  if (found === undefined)
    throw new Error(`no seeded lead for ${name} in company ${String(entityId)}`);
  return found.id;
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
  // As the pre-signed upload leaves it: the bytes in the store, the file checked and ready.
  const fileId = newId();
  const key = `${String(SNAPSHOT_COMPANY.entityId)}/import/${fileId}.csv`;
  await store.put(key, bytes, 'text/csv');
  await createReadyImportFile(SNAPSHOT_COMPANY.entityId, executiveId, {
    id: fileId,
    name: SNAPSHOT_IMPORT_FILE,
    size: bytes.length,
    sha256,
    bucket: store.bucket,
    key,
  });
  await executeCommand(
    principalFor('executive', [1, 2, 3, 4], { id: executiveId }),
    { entityIds: [SNAPSHOT_COMPANY.entityId] },
    createImportJob,
    {
      entityId: SNAPSHOT_COMPANY.entityId,
      kind: 'leads',
      fileId,
      format: parsed.format,
      columns: parsed.columns,
      rows: parsed.rows,
    },
  );
}

/**
 * One Knowledge Vault file in the snapshot company, made once: a checked Word upload added by the
 * Executive (`knowledge.file.add`) and indexed at once by the index job through the fake
 * transport, as the app does on this machine.
 */
async function ensureSnapshotVault(executiveId: string): Promise<void> {
  const [found] = await asMigrator(
    (m) => m<{ n: number }[]>`select count(*)::int as n from knowledge_files
                              where entity_id = ${SNAPSHOT_COMPANY.entityId}
                                and created_by = ${executiveId}`,
  );
  if ((found?.n ?? 0) > 0) return;
  const store = fileStore();
  if (store === undefined) throw new Error('no local file store for the snapshot vault');
  const bytes = wordDocument(SNAPSHOT_VAULT.paragraphs);
  const fileId = newId();
  const type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const key = `${String(SNAPSHOT_COMPANY.entityId)}/knowledge/${fileId}.docx`;
  await store.put(key, bytes, type);
  await asMigrator(
    (m) => m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
      values (${fileId}, ${SNAPSHOT_COMPANY.entityId}, 'knowledge', ${store.bucket}, ${key}, 'Solar pump care.docx',
              ${type}, ${bytes.length}, ${createHash('sha256').update(bytes).digest('hex')}, 'ready', ${executiveId})`,
  );
  const added = await executeCommand(
    principalFor('executive', [1, 2, 3, 4], { id: executiveId }),
    { entityIds: [SNAPSHOT_COMPANY.entityId] },
    addKnowledgeFile,
    {
      entityId: SNAPSHOT_COMPANY.entityId,
      fileId,
      title: SNAPSHOT_VAULT.title,
      sensitivity: 'staff_ai_ok',
    },
  );
  const fake = fakeModelTransport();
  await indexKnowledgeFile(
    {
      eventId: newId(),
      knowledgeFileId: added.id,
      entityId: SNAPSHOT_COMPANY.entityId,
      fileEntityId: SNAPSHOT_COMPANY.entityId,
      sensitivity: 'staff_ai_ok',
    },
    {
      principal: principalFor('system:workers', [SNAPSHOT_COMPANY.entityId], {
        id: SYSTEM_WORKERS_PRINCIPAL_ID,
      }),
      store,
      provider: createAiProvider({
        claude: fake,
        voyage: fake,
        keyValue: memoryKeyValue(),
        logger: memoryLogger(),
      }),
      readWord: readWordText,
      requestId: newId(),
      hosted: false,
      logger: memoryLogger(),
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

progress('the calling team');
// The tele-caller and the team lead share a team in company 1, so the team lead's view of the
// team's queues lists the tele-caller (calling.spec.ts).
await asMigrator((m) =>
  m.begin(async (tx) => {
    const [found] = await tx<{ id: string }[]>`
      select id from teams where entity_id = 1 and name = ${CALLING_TEAM}`;
    const teamId = found?.id ?? newId();
    if (found === undefined) {
      await tx`insert into teams (id, entity_id, name) values (${teamId}, 1, ${CALLING_TEAM})`;
    }
    await tx`update user_entity_roles set team_id = ${teamId}
              where entity_id = 1 and user_id in (${ids.teleCaller ?? ''}, ${ids.teamLead ?? ''})`;
  }),
);

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
progress('the snapshot company’s Knowledge Vault file');
await ensureSnapshotVault(ids.executive ?? '');

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

progress('the suggestions of the stand-in agent');
// The Caller Co-pilot may run in the companies of the inbox journeys, with a daily spending
// limit, its suggestions needing approval, and is not stopped anywhere a journey left it stopped.
// Fixed ids, so each run resets them; a setting a test left for one action type goes.
for (const [n, entityId] of [1, 2, 3].entries()) {
  await asMigrator(
    (
      m,
    ) => m`insert into agent_configs (id, agent, action_type, entity_id, autonomy, daily_spend_cap_paise, enabled, created_by)
             values (${`0199e2e0-0000-7000-8000-00000000a00${String(n)}`}, 'agent:copilot', null,
                     ${entityId}, 'needs_approval', 100000, true, ${ids.executive ?? ''})
             on conflict (agent, action_type, entity_id) do update
               set daily_spend_cap_paise = 100000, enabled = true, autonomy = 'needs_approval'`,
  );
}
await asMigrator(
  (m) => m`delete from agent_configs
            where (agent is null or agent = 'agent:copilot')
              and ((entity_id is null and not enabled)
                or (action_type is not null and entity_id in (1, 2, 3)))`,
);
// Earlier runs' open suggestions are taken away, so every inbox starts from this run's.
await asMigrator(
  (m) => m`delete from inbox_items
            where state = 'open' and created_by = ${AGENT_PRINCIPAL_IDS['agent:copilot']}
              and entity_id in (1, 2, 3)`,
);
const inThreeDays = () => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
const caller = { id: ids.teleCaller ?? '', entity: 1 };
const callerLead = await leadId(caller.id, caller.entity, 'Kavita Saini');
for (const project of PROJECTS) {
  for (const title of [INBOX_SUGGESTIONS[project].approve, INBOX_SUGGESTIONS[project].edit]) {
    await suggestFollowUp({
      entityId: caller.entity,
      opportunityId: callerLead,
      title,
      dueAt: inThreeDays(),
      assigneeId: caller.id,
    });
  }
}
// One suggestion per project for the caller to act on herself: filed under Suggest, set for the
// follow-ups in company 1 while it is filed.
const suggestOnly = '0199e2e0-0000-7000-8000-00000000a010';
await asMigrator(
  (m) => m`insert into agent_configs (id, agent, action_type, entity_id, autonomy, created_by)
             values (${suggestOnly}, 'agent:copilot', 'crm.task.create', ${caller.entity}, 'suggest',
                     ${ids.executive ?? ''})`,
);
for (const project of PROJECTS) {
  await suggestFollowUp({
    entityId: caller.entity,
    opportunityId: callerLead,
    title: INBOX_SUGGESTIONS[project].dismiss,
    dueAt: inThreeDays(),
    assigneeId: caller.id,
  });
}
await asMigrator((m) => m`delete from agent_configs where id = ${suggestOnly}`);
const snapshotLead = await leadId(
  ids.snapshotCaller ?? '',
  SNAPSHOT_COMPANY.entityId,
  SNAPSHOT_LEADS[0].name,
);
for (const suggestion of SNAPSHOT_SUGGESTIONS) {
  await suggestFollowUp({
    entityId: SNAPSHOT_COMPANY.entityId,
    opportunityId: snapshotLead,
    title: suggestion.title,
    dueAt: suggestion.dueAt,
    assigneeId: ids.snapshotCaller ?? '',
  });
}
await suggestFollowUp({
  entityId: KILL_SWITCH.company.entityId,
  opportunityId: await leadId(ids.executive ?? '', KILL_SWITCH.company.entityId, secondCompanyLead),
  title: KILL_SWITCH.title,
  dueAt: inThreeDays(),
  assigneeId: ids.executive ?? '',
});

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
