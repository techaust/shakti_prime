import {
  AGENT_FORBIDDEN_PERMISSIONS,
  FILE_PURPOSES,
  newId,
  PLATFORM_ONLY_PERMISSIONS,
  SYSTEM_ROLE_KEYS,
  type AgentRoleKey,
  type PermissionGrant,
  type PermissionKey,
  type SystemRoleKey,
} from '@shakti/contracts';
import {
  AGENT_MATRIX,
  asMigrator,
  asPrincipal,
  closeDb,
  principalFor,
  SYSTEM_MATRIX,
} from '@shakti/db/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { commands } from '../../src/command/registry';
import { beginUpload } from '../../src/commands/files/begin-upload';
import { failureOf, runCommand } from '../../src/command/run-command';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';

afterAll(closeDb);

/**
 * SECURITY §11 item 3: no agent principal, and not the system principal the event workers act as
 * (`system:workers`), may call a command that needs an admin, cost, audit, integrations, tax-rate,
 * price, catalogue or CRM set-up permission (SECURITY §3.3: agents make no price edits). The
 * commands are read from the registry, so a new one that needs such a permission is covered the
 * day it is registered.
 */
const PRICE_AND_CATALOGUE_EDITS: readonly PermissionKey[] = ['pricing.write', 'catalogue.write'];

function isRestricted(key: PermissionKey): boolean {
  return (
    (AGENT_FORBIDDEN_PERMISSIONS as readonly PermissionKey[]).includes(key) ||
    key.startsWith('admin.') ||
    key.startsWith('audit.') ||
    key.startsWith('integrations.') ||
    key === 'tax.rates.write' ||
    PRICE_AND_CATALOGUE_EDITS.includes(key)
  );
}

function needs(command: AnyCommand): PermissionKey[] {
  const own =
    typeof command.permission === 'string' ? [command.permission] : command.permission.keys;
  return [...own, ...(command.alsoRequires ?? []).map((a) => a.permission)];
}

const RESTRICTED: AnyCommand[] = Object.values(commands as Record<string, AnyCommand>)
  .filter((command) => needs(command).some(isRestricted))
  .sort((a, b) => a.name.localeCompare(b.name));

const AGENTS = Object.keys(AGENT_MATRIX) as AgentRoleKey[];

/** Every service principal the sweep covers: the agents and the system principal. */
const SERVICES: (AgentRoleKey | SystemRoleKey)[] = [...AGENTS, ...SYSTEM_ROLE_KEYS];

function grantsOf(role: AgentRoleKey | SystemRoleKey): readonly PermissionGrant[] {
  return role.startsWith('system:')
    ? SYSTEM_MATRIX[role as SystemRoleKey]
    : AGENT_MATRIX[role as AgentRoleKey];
}

/**
 * A valid input for each restricted command, so the refusal comes from the guard and not from
 * validation. A command added to the registry with a restricted permission fails the first test
 * below until it has an input here.
 */
const INPUTS: Record<string, unknown> = {
  'admin.role.permissions.set': {
    roleKey: 'tele_caller_cc',
    grants: [{ permission: 'crm.lead.read', scope: 'all' }],
    expectedVersion: '0'.repeat(64),
  },
  'admin.session.revoke': { sessionId: newId() },
  'admin.user.lock.clear': { userId: newId() },
  'admin.user.invite': {
    email: 'agent-refusal@shakti.test',
    displayName: 'Refused invite',
    entityRoles: [{ entityId: 1, roleKey: 'tele_caller_cc' }],
  },
  'admin.user.reactivate': { userId: newId() },
  'admin.user.role.set': {
    userId: newId(),
    entityRoles: [{ entityId: 1, roleKey: 'tele_caller_cc' }],
  },
  'admin.user.suspend': { userId: newId() },
  'admin.user.two_factor.reset': { userId: newId() },
  'crm.commission_rule.set': {
    partnerId: null,
    basis: 'fixed',
    amount: '500.00',
    effectiveFrom: '2031-04-01',
  },
  'crm.disposition.set': {
    entityId: 1,
    segment: null,
    dispositions: [{ key: 1, label: 'Interested', nextAction: 'callback' }],
  },
  'crm.pipeline.update': { pipelineId: newId(), lockHours: 24 },
  'crm.referral_partner.set': { accountId: newId(), code: 'AGENT123', isActive: true },
  'crm.score_rule.set': { entityId: 1, segment: null, rules: [] },
  'crm.stage.archive': { stageId: newId() },
  'crm.stage.create': { pipelineId: newId(), name: 'Refused stage' },
  'crm.stage.reorder': { pipelineId: newId(), stageIds: [newId()] },
  'crm.stage.update': { stageId: newId(), name: 'Refused stage' },
  'catalogue.item.archive': { itemId: newId() },
  'catalogue.item.create': {
    sku: 'REFUSED-1',
    name: 'Refused item',
    category: 'other',
    hsn: '8413',
    unit: 'nos',
    specs: {},
  },
  'catalogue.item.update': {
    itemId: newId(),
    sku: 'REFUSED-1',
    name: 'Refused item',
    category: 'other',
    hsn: '8413',
    unit: 'nos',
    specs: {},
  },
  'catalogue.kit.archive': { kitId: newId() },
  'catalogue.kit.create': {
    sku: 'REFUSED-KIT',
    name: 'Refused kit',
    components: [{ itemId: newId(), qty: '1' }],
  },
  'catalogue.kit.update': {
    kitId: newId(),
    sku: 'REFUSED-KIT',
    name: 'Refused kit',
    components: [{ itemId: newId(), qty: '1' }],
  },
  'catalogue.pump_curve.set': {
    itemId: newId(),
    points: [
      { flowLph: '0', headM: '50' },
      { flowLph: '1000', headM: '20' },
    ],
  },
  // A logo needs admin.entities.write, which no agent holds (the upload's permission is its
  // purpose's, files/purposes.ts).
  'files.upload.begin': {
    entityId: 1,
    purpose: 'entity_logo',
    name: 'Refused logo.png',
    contentType: 'image/png',
    size: 10,
    sha256: 'a'.repeat(64),
    bucket: 'local',
  },
  'files.upload.complete': {
    fileId: newId(),
    purpose: 'letterhead',
    stored: { size: 10, sha256: 'a'.repeat(64) },
  },
  'files.file.recheck': { olderThanMinutes: 10 },
  'integrations.dlq.replay': { eventId: newId() },
  'platform.probe.run': {},
  'org.entity.update': { entityId: 1, brandName: 'Refused brand' },
  'pricing.list.approve': { priceListId: newId() },
  'pricing.list.archive': { priceListId: newId() },
  'pricing.list.create': { tierCode: 'retail', effectiveFrom: '2031-04-01' },
  'pricing.price.set': {
    priceListId: newId(),
    itemId: newId(),
    price: '1500.00',
    reason: 'Refused price edit',
  },
  'tax.composite.set': {
    segment: 'residential_rooftop',
    goodsSharePct: '70.00',
    servicesSharePct: '30.00',
    goodsRatePct: '5.00',
    servicesRatePct: '18.00',
    effectiveFrom: '2031-04-01',
  },
  'tax.rate.set': { hsn: '8413', ratePct: '18.00', effectiveFrom: '2031-04-01' },
};

describe('agent and system principals cannot call admin, cost, audit, integrations, tax, price, catalogue or CRM set-up commands', () => {
  it('finds the restricted commands in the registry, each with a valid input here', () => {
    expect(RESTRICTED.length).toBeGreaterThan(0);
    expect(RESTRICTED.map((c) => c.name)).toEqual(Object.keys(INPUTS).sort());
    for (const command of RESTRICTED) {
      const parsed = command.input.safeParse(INPUTS[command.name]);
      expect({ command: command.name, valid: parsed.success }).toEqual({
        command: command.name,
        valid: true,
      });
    }
  });

  it('no agent or system principal in the matrix holds a restricted permission', () => {
    for (const agent of SERVICES) {
      const held = grantsOf(agent)
        .map((g) => g.key)
        .filter(isRestricted);
      expect({ agent, held }).toEqual({ agent, held: [] });
    }
  });

  it('no agent or system role in the seeded database holds a restricted permission', async () => {
    // The matrices above are the seed's source; this reads what the seed actually wrote.
    const rows = await asMigrator(
      (m) => m<{ role: string; permission: PermissionKey }[]>`
        select r.key as role, rp.permission_key as permission
          from role_permissions rp
          join roles r on r.id = rp.role_id
         where r.key like 'agent:%' or r.key like 'system:%'
         order by r.key, rp.permission_key`,
    );
    // A role with no grant has no row, as the system principal has none yet.
    expect(new Set(rows.map((r) => r.role))).toEqual(
      new Set(SERVICES.filter((role) => grantsOf(role).length > 0)),
    );
    const [seeded] = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from roles where key like 'agent:%' or key like 'system:%'`,
    );
    expect(seeded?.n).toBe(SERVICES.length);
    const held = rows.filter((r) => isRestricted(r.permission));
    expect(held).toEqual([]);
    for (const key of PRICE_AND_CATALOGUE_EDITS) {
      expect(rows.filter((r) => r.permission === key)).toEqual([]);
    }
  });

  it('holds price and catalogue edits to the restricted set', () => {
    for (const key of PRICE_AND_CATALOGUE_EDITS) expect(isRestricted(key)).toBe(true);
    expect(RESTRICTED.map((c) => c.name)).toContain('pricing.price.set');
  });

  for (const agent of SERVICES) {
    it(`${agent} is refused at the guard by every restricted command`, async () => {
      // principalFor, not createTestPrincipal: an agent principals row would change the agent
      // count the fail-closed suite checks.
      const principal = principalFor(agent, [1]);
      for (const command of RESTRICTED) {
        const error: unknown = await asPrincipal(principal, (context) =>
          runCommand(command, { context, audit, outbox }, INPUTS[command.name]),
        ).then(
          () => undefined,
          (e: unknown) => e,
        );
        expect({ command: command.name, error }).toMatchObject({
          command: command.name,
          error: { code: 'forbidden' },
        });
        expect({ command: command.name, stage: failureOf(error)?.stage }).toEqual({
          command: command.name,
          stage: 'guard',
        });
      }
    });
  }
});

/**
 * SECURITY §3.3: agents never write the customer master; no agent holds `crm.account.write`.
 * Every command that needs it, read from the registry, refuses every agent at the guard: the
 * lead form, imports, the customer edits and the consents of Account 360 (docs/design/phase1.md
 * §6.5), and the upload of a consent's proof (the `consent_evidence` purpose names it).
 */
const CUSTOMER_WRITES: AnyCommand[] = Object.values(commands as Record<string, AnyCommand>)
  .filter((command) => needs(command).includes('crm.account.write'))
  .sort((a, b) => a.name.localeCompare(b.name));

const CUSTOMER = { entityId: 1, accountId: newId() };
const CUSTOMER_INPUTS: Record<string, unknown> = {
  'crm.account.update': { ...CUSTOMER, name: 'Refused customer name' },
  'crm.contact.update': { ...CUSTOMER, contactId: newId(), name: 'Refused contact name' },
  'crm.consent.record': {
    ...CUSTOMER,
    contactId: newId(),
    channel: 'call',
    purpose: 'service',
    source: 'verbal',
    textVersion: 'v1',
    givenAt: '2026-01-01T00:00:00Z',
  },
  'crm.consent.withdraw': { ...CUSTOMER, consentId: newId() },
  'crm.lead.create': {
    entityId: 1,
    pipelineKey: 'farmer_pumps',
    contact: { name: 'Refused lead', phone: '9800000000' },
    account: { type: 'farm' },
  },
  'crm.site.upsert': { ...CUSTOMER, type: 'borewell', village: 'Refused village' },
  // The proof of a consent, uploaded before the consent names it.
  'files.upload.begin': {
    entityId: 1,
    purpose: 'consent_evidence',
    name: 'Refused consent form.pdf',
    contentType: 'application/pdf',
    size: 10,
    sha256: 'a'.repeat(64),
    bucket: 'local',
  },
  'files.upload.complete': {
    fileId: newId(),
    purpose: 'consent_evidence',
    stored: { size: 10, sha256: 'a'.repeat(64) },
  },
  // An import makes customers the way the lead form does.
  'imports.job.commit': { entityId: 1, jobId: newId() },
  'imports.job.commit_batch': { entityId: 1, jobId: newId() },
};

describe('agent principals never write the customer master (SECURITY §3.3)', () => {
  it('finds the customer writes in the registry, each with a valid input here', () => {
    expect(CUSTOMER_WRITES.map((c) => c.name)).toEqual(Object.keys(CUSTOMER_INPUTS).sort());
    for (const command of CUSTOMER_WRITES) {
      expect({
        command: command.name,
        valid: command.input.safeParse(CUSTOMER_INPUTS[command.name]).success,
      }).toEqual({ command: command.name, valid: true });
    }
  });

  it('no agent holds crm.account.write', () => {
    for (const agent of AGENTS) {
      const held = AGENT_MATRIX[agent].filter((g) => g.key === 'crm.account.write');
      expect({ agent, held }).toEqual({ agent, held: [] });
    }
  });

  for (const agent of AGENTS) {
    it(`${agent} is refused at the guard by every customer write`, async () => {
      const principal = principalFor(agent, [1]);
      for (const command of CUSTOMER_WRITES) {
        const error: unknown = await asPrincipal(principal, (context) =>
          runCommand(command, { context, audit, outbox }, CUSTOMER_INPUTS[command.name]),
        ).then(
          () => undefined,
          (e: unknown) => e,
        );
        expect({ command: command.name, stage: failureOf(error)?.stage }).toEqual({
          command: command.name,
          stage: 'guard',
        });
      }
    });
  }
});

/**
 * Every command of the customer timeline slice (docs/design/phase1.md §6.5), for every agent: a
 * command the agent lacks a permission for, or one for people only (`peopleOnly`: notes and making
 * or archiving tags, SECURITY §3.3), is refused at the guard; any other passes the guard and then
 * finds nothing to change (the inputs name no real row). The Co-pilot's follow-up tasks and the
 * Triage agent's tags on leads are the ones that pass.
 */
const TIMELINE_INPUTS: Record<string, unknown> = {
  'crm.task.create': {
    entityId: 1,
    opportunityId: newId(),
    kind: 'follow_up',
    dueAt: '2031-01-01T10:00:00Z',
  },
  'crm.task.complete': { entityId: 1, taskId: newId() },
  'crm.task.reschedule': { entityId: 1, taskId: newId(), dueAt: '2031-01-01T10:00:00Z' },
  'crm.task.cancel': { entityId: 1, taskId: newId() },
  'crm.tag.create': { entityId: 1, name: 'Refused tag' },
  'crm.tag.archive': { tagId: newId() },
  'crm.lead.tag': { entityId: 1, opportunityId: newId(), tagId: newId() },
  'crm.lead.untag': { entityId: 1, opportunityId: newId(), tagId: newId() },
  'crm.note.add': { ...CUSTOMER, body: 'Refused note' },
  ...CUSTOMER_INPUTS,
};
const TIMELINE_COMMANDS = [
  'crm.task.create',
  'crm.task.complete',
  'crm.task.reschedule',
  'crm.task.cancel',
  'crm.tag.create',
  'crm.tag.archive',
  'crm.lead.tag',
  'crm.lead.untag',
  'crm.note.add',
  'crm.account.update',
  'crm.contact.update',
  'crm.site.upsert',
  'crm.consent.record',
  'crm.consent.withdraw',
];

describe('agent principals and the customer timeline commands', () => {
  const byName = commands as Record<string, AnyCommand>;

  it('has an input for each command, and each is registered', () => {
    for (const name of TIMELINE_COMMANDS) {
      const command = byName[name];
      expect({ name, registered: command !== undefined }).toEqual({ name, registered: true });
      expect({ name, valid: command?.input.safeParse(TIMELINE_INPUTS[name]).success }).toEqual({
        name,
        valid: true,
      });
    }
  });

  for (const agent of AGENTS) {
    it(`${agent} is refused at the guard exactly where it lacks a permission or the command is for people`, async () => {
      const principal = principalFor(agent, [1]);
      const held = AGENT_MATRIX[agent];
      for (const name of TIMELINE_COMMANDS) {
        const command = byName[name];
        if (command === undefined) throw new Error(`${name} is not registered`);
        const holds = [
          { permission: command.permission, minScope: command.minScope ?? 'own' },
          ...(command.alsoRequires ?? []),
        ].every((need) =>
          held.some(
            (g) =>
              g.key === need.permission &&
              ['own', 'team', 'entity', 'all'].indexOf(g.scope) >=
                ['own', 'team', 'entity', 'all'].indexOf(need.minScope),
          ),
        );
        const refusedAtGuard = command.peopleOnly === true || !holds;
        const error: unknown = await asPrincipal(principal, (context) =>
          runCommand(command, { context, audit, outbox }, TIMELINE_INPUTS[name]),
        ).then(
          () => undefined,
          (e: unknown) => e,
        );
        expect({ name, guard: failureOf(error)?.stage === 'guard' }).toEqual({
          name,
          guard: refusedAtGuard,
        });
      }
    });
  }

  it('lets the Co-pilot add follow-up tasks and the Triage agent tag leads, never make tags or notes', () => {
    const passes = (agent: AgentRoleKey, name: string) => {
      const command = byName[name];
      const held = AGENT_MATRIX[agent].map((g) => g.key);
      return (
        command !== undefined &&
        command.peopleOnly !== true &&
        needs(command).every((k) => held.includes(k))
      );
    };
    expect(passes('agent:copilot', 'crm.task.create')).toBe(true);
    expect(passes('agent:triage', 'crm.lead.tag')).toBe(true);
    for (const agent of AGENTS) {
      expect(passes(agent, 'crm.note.add')).toBe(false);
      expect(passes(agent, 'crm.tag.create')).toBe(false);
      expect(passes(agent, 'crm.tag.archive')).toBe(false);
    }
  });
});

describe('agent principals cannot upload a file of any purpose', () => {
  for (const agent of AGENTS) {
    it(`${agent} is refused files.upload.begin for every purpose`, async () => {
      const principal = principalFor(agent, [1]);
      for (const purpose of FILE_PURPOSES) {
        const error: unknown = await asPrincipal(principal, (context) =>
          runCommand(
            beginUpload,
            { context, audit, outbox },
            {
              entityId: 1,
              purpose,
              name: 'Refused upload.pdf',
              contentType: purpose === 'signature' ? 'image/png' : 'application/pdf',
              size: 10,
              sha256: 'a'.repeat(64),
              bucket: 'local',
            },
          ),
        ).then(
          () => undefined,
          (e: unknown) => e,
        );
        // An import file never comes through this door at all; every other purpose stops at the
        // guard, before anything is recorded.
        const expected =
          purpose === 'import'
            ? { purpose, code: 'validation_failed', stage: 'input' }
            : { purpose, code: 'forbidden', stage: 'guard' };
        expect({
          purpose,
          code: (error as { code?: string } | undefined)?.code,
          stage: failureOf(error)?.stage,
        }).toEqual(expected);
      }
    });
  }
});

describe("agent principals cannot run the platform's own work: the file checks and the nightly rescoring", () => {
  const CHECKS: Record<string, unknown> = {
    'crm.lead.score_refresh': { entityId: 1, afterId: null },
    'files.file.mark_scanned': { entityId: 1, fileId: newId(), verdict: 'no_threats_found' },
    'files.file.mark_ready': {
      entityId: 1,
      fileId: newId(),
      sanitising: 'pdf_checked',
      stored: {
        key: '1/quote_pdf/x.pdf',
        contentType: 'application/pdf',
        size: 1,
        sha256: 'a'.repeat(64),
      },
    },
    'files.file.reject': { entityId: 1, fileId: newId(), reason: 'file_infected' },
  };

  it('no agent in the matrix holds a platform-only permission, which only the worker principal may', () => {
    for (const agent of AGENTS) {
      expect(AGENT_MATRIX[agent].filter((g) => PLATFORM_ONLY_PERMISSIONS.includes(g.key))).toEqual(
        [],
      );
    }
  });

  it('runs every check and the rescoring with nothing but platform-only permissions', () => {
    for (const name of Object.keys(CHECKS)) {
      const command = (commands as Record<string, AnyCommand>)[name];
      if (command === undefined) throw new Error(`no command ${name}`);
      expect({
        name,
        needs: needs(command).filter((k) => !PLATFORM_ONLY_PERMISSIONS.includes(k)),
      }).toEqual({ name, needs: [] });
    }
  });

  for (const agent of AGENTS) {
    it(`${agent} is refused at the guard by every file check and the rescoring`, async () => {
      const principal = principalFor(agent, [1]);
      for (const [name, input] of Object.entries(CHECKS)) {
        const command = (commands as Record<string, AnyCommand>)[name];
        if (command === undefined) throw new Error(`no command ${name}`);
        const error: unknown = await asPrincipal(principal, (context) =>
          runCommand(command, { context, audit, outbox }, input),
        ).then(
          () => undefined,
          (e: unknown) => e,
        );
        expect({ name, code: (error as { code?: string } | undefined)?.code }).toEqual({
          name,
          code: 'forbidden',
        });
        expect(failureOf(error)?.stage).toBe('guard');
      }
    });
  }
});
