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
  notifyEvent,
  parseImportFile,
  setReferralPartner,
  setTarget,
} from '@shakti/domain';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAuth } from '../../src/auth/create-auth';
import { fileStore } from '../../src/files/store';
import { renderMaskedPages } from '../../src/workers/files/pdf-pages';
import { readWordText } from '../../src/workers/knowledge/read-word';
import { wordDocument } from '../support/docx';
import { writePrintPages } from './print-pages';
import { ensureOrderJourneys } from './orders';
import { resetPipelineStages } from './pipelines';
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
  SNAPSHOT_TEAM,
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

/** The team the person belongs to in a company. */
async function teamOf(userId: string, entityId: number): Promise<string> {
  const [found] = await asMigrator(
    (m) => m<{ team_id: string | null }[]>`
      select team_id from user_entity_roles where user_id = ${userId} and entity_id = ${entityId}`,
  );
  if (found?.team_id == null)
    throw new Error(`${userId} is in no team of company ${String(entityId)}`);
  return found.team_id;
}

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** The start of the Indian day `days` after today's (0 is today), as milliseconds since 1970. */
function istDayStart(days: number): number {
  return Math.floor((Date.now() + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS + days * DAY_MS;
}

/** The same id for the same label on every run, so a row written again is found, not doubled. */
function stableId(label: string): string {
  const h = createHash('sha1').update(label).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-7${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Calls a person logged on one lead "today", written as the table owner so they exist whatever the
 * hour (calling itself is possible only from 9 AM to 9 PM; the journeys' own calls run on a shifted
 * clock, never these). Written for today and for tomorrow of the Indian calendar, at 10 AM: a seed
 * that runs just before midnight and journeys that run just after it each find the same figure
 * "today", and a seed run again the same day writes nothing more (fixed ids per day).
 */
async function seedCalls(
  label: string,
  who: { callerId: string; entityId: number; opportunityId: string; count: number },
): Promise<void> {
  const [outcome] = await asMigrator(
    (m) => m<{ id: string }[]>`
      select id from call_dispositions
       where entity_id is null and segment is null and archived_at is null
       order by position limit 1`,
  );
  if (outcome === undefined) throw new Error('no call outcome seeded');
  for (const day of [0, 1]) {
    const dayStart = istDayStart(day);
    const date = new Date(dayStart + IST_OFFSET_MS).toISOString().slice(0, 10);
    for (let n = 0; n < who.count; n += 1) {
      const startedAt = new Date(dayStart + 10 * 3_600_000 + n * 60_000).toISOString();
      await asMigrator(
        (m) => m`insert into calls (id, entity_id, opportunity_id, caller_id, direction,
                                   number_series, disposition_id, attempt_no, started_at)
                 values (${stableId(`${label}:${date}:${String(n)}`)}, ${who.entityId},
                         ${who.opportunityId}, ${who.callerId}, 'outbound', 'manual',
                         ${outcome.id}, 1, ${startedAt}::timestamptz)
                 on conflict (id) do nothing`,
      );
    }
  }
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
    (
      m,
    ) => m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
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
      pdfPages: renderMaskedPages,
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
              where entity_id = 1
                and user_id in (${ids.teleCaller ?? ''}, ${ids.teamLead ?? ''}, ${ids.converter ?? ''})`;
  }),
);

progress('the snapshot company’s team');
// The snapshot team lead and the tracked caller share a team there (users.ts, SNAPSHOT_TEAM).
await asMigrator((m) =>
  m.begin(async (tx) => {
    const [found] = await tx<{ id: string }[]>`
      select id from teams where entity_id = ${SNAPSHOT_COMPANY.entityId}
                             and name = ${SNAPSHOT_TEAM.name}`;
    const teamId = found?.id ?? newId();
    if (found === undefined) {
      await tx`insert into teams (id, entity_id, name)
               values (${teamId}, ${SNAPSHOT_COMPANY.entityId}, ${SNAPSHOT_TEAM.name})`;
    }
    await tx`update user_entity_roles set team_id = ${teamId}
              where entity_id = ${SNAPSHOT_COMPANY.entityId}
                and user_id in (${ids.snapshotLead ?? ''}, ${ids.snapshotTracker ?? ''})`;
    // A target is set only for an active person, and the seed sets it before anyone signs in.
    await tx`update users set status = 'active'
              where id in (${ids.snapshotLead ?? ''}, ${ids.snapshotTracker ?? ''})`;
  }),
);

progress('the lead converter');
// Present and taking every language and business line, so a qualified lead of company 1 goes to
// her (handover.spec.ts); every run starts her present with no cap.
await asMigrator(
  (m) => m`insert into caller_profiles (id, user_id, entity_id, is_converter, presence)
             values (${newId()}, ${ids.converter ?? ''}, 1, true, 'present')
             on conflict (user_id, entity_id) do update
               set is_converter = true, presence = 'present', max_open = null,
                   languages = '{}', segments = '{}'`,
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

progress('the leaving callers');
// Per project, a caller with two open leads of their own in company 1, made afresh on every run
// (the Move all leads journey moves them away), so the Team members list always has one to move.
// A second caller per project sits in the calling team, so the Sales Team Lead's own move of a
// leaving caller's leads (Lead converters, handover.spec.ts) has two leads of the team to move.
const [callingTeam] = await asMigrator(
  (m) => m<{ id: string }[]>`select id from teams where entity_id = 1 and name = ${CALLING_TEAM}`,
);
for (const project of PROJECTS) {
  for (const inTeam of [false, true]) {
    if (inTeam && callingTeam === undefined) continue;
    const email = emailFor(`${inTeam ? 'team-leaver' : 'leaver'}-${project}`);
    const leaverId = await ensureUser(
      email,
      `${inTeam ? 'E2E team leaver' : 'E2E leaver'} ${project}`,
      'tele_caller_cc',
      [1],
    );
    if (inTeam) {
      await asMigrator(
        (m) => m`update user_entity_roles set team_id = ${callingTeam?.id ?? ''}
                  where user_id = ${leaverId} and entity_id = 1`,
      );
      await asMigrator((m) => m`update users set status = 'active' where id = ${leaverId}`);
    }
    const principal = principalFor('tele_caller_cc', [1], {
      id: leaverId,
      ...(inTeam && callingTeam !== undefined ? { teamId: callingTeam.id } : {}),
    });
    await leaverLeads(principal, inTeam ? `team ${project}` : project);
  }
}

async function leaverLeads(principal: ReturnType<typeof principalFor>, label: string) {
  // Leads an earlier run left with them (a journey that did not run, or failed) are set aside, so
  // every run starts with exactly two to move.
  await asMigrator(
    (m) => m`update opportunities set archived_at = now()
              where owner_id = ${principal.id} and archived_at is null`,
  );
  for (const n of [1, 2]) {
    const digits = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
    await executeCommand(principal, {}, createLead, {
      entityId: 1,
      pipelineKey: 'farmer_pumps',
      contact: { name: `Leaver customer ${label} ${String(n)}`, phone: digits },
      account: { type: 'farm' },
      site: { type: 'borewell', village: 'Kishangarh', pin: '305801' },
      consent: {
        channel: 'whatsapp',
        purpose: 'service',
        source: 'walk_in_form',
        textVersion: 'v1',
      },
      sourceCode: 'walk_in',
    });
  }
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

progress('the tele-caller’s calls today');
// Two calls the tele-caller logged today on her lead: the home page's progress counts them
// (targets.spec.ts).
await seedCalls('tele-caller', {
  callerId: ids.teleCaller ?? '',
  entityId: 1,
  opportunityId: await leadId(ids.teleCaller ?? '', 1, 'Kavita Saini'),
  count: 2,
});

progress('the pipelines’ stages');
await resetPipelineStages(ids.executive ?? '');

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

progress('the orders and dealers');
const orders = await ensureOrderJourneys(ids.executive ?? '');

progress('the snapshot team’s target, calls and notices');
const snapshotPrincipals = {
  lead: principalFor('sales_team_lead', [SNAPSHOT_COMPANY.entityId], {
    id: ids.snapshotLead ?? '',
    teamId: await teamOf(ids.snapshotLead ?? '', SNAPSHOT_COMPANY.entityId),
  }),
};
// The tracked caller's daily call target, set once through the command by her team lead; it holds
// from a fixed day until a newer one is set, and no journey sets one in this company.
const [haveTarget] = await asMigrator(
  (m) => m<{ n: number }[]>`select count(*)::int as n from targets
                            where entity_id = ${SNAPSHOT_COMPANY.entityId}
                              and subject_id = ${ids.snapshotTracker ?? ''}`,
);
if ((haveTarget?.n ?? 0) === 0) {
  await executeCommand(
    snapshotPrincipals.lead,
    { entityIds: [SNAPSHOT_COMPANY.entityId] },
    setTarget,
    {
      entityId: SNAPSHOT_COMPANY.entityId,
      scope: 'caller',
      subjectId: ids.snapshotTracker ?? '',
      metric: 'calls',
      period: 'day',
      startsOn: '2026-01-01',
      value: SNAPSHOT_TEAM.dailyCallTarget,
    },
  );
}
// Her calls today, on the sized lead of the snapshot company (a lead no queue shows).
await seedCalls('snapshot-tracker', {
  callerId: ids.snapshotTracker ?? '',
  entityId: SNAPSHOT_COMPANY.entityId,
  opportunityId: quotes.snapshotLeadId,
  count: SNAPSHOT_TEAM.callsToday,
});
// The snapshot caller's notices: her team lead gave her each of her three leads, as the notify
// worker writes it (fixed event ids, so a notice is made once). Every run leaves them unread.
for (const [n, lead] of SNAPSHOT_LEADS.entries()) {
  await executeCommand(
    principalFor('system:workers', [SNAPSHOT_COMPANY.entityId], {
      id: SYSTEM_WORKERS_PRINCIPAL_ID,
    }),
    { entityIds: [SNAPSHOT_COMPANY.entityId] },
    notifyEvent,
    {
      event: 'crm.opportunity.assigned',
      entityId: SNAPSHOT_COMPANY.entityId,
      eventId: stableId(`snapshot-assigned:${lead.name}`),
      opportunityId: await leadId(ids.snapshotCaller ?? '', SNAPSHOT_COMPANY.entityId, lead.name),
      ownerId: ids.snapshotCaller ?? '',
      assignedById: ids.snapshotLead ?? '',
    },
  );
  progress(`a notice for the snapshot caller (${String(n + 1)})`);
}
await asMigrator(
  (m) => m`update notifications set read_at = null
            where user_id = ${ids.snapshotCaller ?? ''} and read_at is not null`,
);

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
  orders,
};
writeFileSync(join(AUTH_DIR, 'users.json'), JSON.stringify(seeded, null, 2));
await writePrintPages();
progress(`${String(SIGNED_IN_ROLES.length)} roles and ${String(PROJECTS.length)} projects ready`);

await closeAuthDb();
await closeDb();
clearTimeout(watchdog);
process.exit(0);
