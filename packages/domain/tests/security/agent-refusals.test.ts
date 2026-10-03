import {
  AGENT_FORBIDDEN_PERMISSIONS,
  newId,
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
import { failureOf, runCommand } from '../../src/command/run-command';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';

afterAll(closeDb);

/**
 * SECURITY §11 item 3: no agent principal, and not the system principal the event workers act as
 * (`system:workers`), may call a command that needs an admin, cost, audit, integrations, tax-rate,
 * price or catalogue permission (SECURITY §3.3: agents make no price edits). The commands are read
 * from the registry, so a new one that needs such a permission is covered the day it is
 * registered.
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
  return [command.permission, ...(command.alsoRequires ?? []).map((a) => a.permission)];
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
  'integrations.dlq.replay': { eventId: newId() },
  'platform.probe.run': {},
  'org.entity.update': { entityId: 1, brandName: 'Refused brand' },
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

/** The commands only people may call (`peopleOnly`), read from the registry. */
const PEOPLE_ONLY: AnyCommand[] = Object.values(commands as Record<string, AnyCommand>)
  .filter((command) => command.peopleOnly === true)
  .sort((a, b) => a.name.localeCompare(b.name));

/** A valid input for each command for people only, so the refusal comes from the guard. */
const PEOPLE_ONLY_INPUTS: Record<string, unknown> = {
  'crm.sizing.record': {
    entityId: 1,
    opportunityId: newId(),
    sizing: {
      kind: 'rooftop',
      inputs: { monthlyUnitsKwh: 300, roofAreaSqm: 40, sanctionedLoadKw: 5 },
    },
  },
};

describe('commands for people only', () => {
  it('are found in the registry, each with a valid input here', () => {
    expect(PEOPLE_ONLY.map((c) => c.name)).toEqual(Object.keys(PEOPLE_ONLY_INPUTS).sort());
    for (const command of PEOPLE_ONLY) {
      expect({
        command: command.name,
        valid: command.input.safeParse(PEOPLE_ONLY_INPUTS[command.name]).success,
      }).toEqual({ command: command.name, valid: true });
    }
  });
});

describe('agent and system principals cannot call admin, cost, audit, integrations, tax, price or catalogue commands', () => {
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
    it(`${agent} is refused at the guard by every command for people only, even with its grants`, async () => {
      // The owner's decision of 30-09-2026 (SECURITY §3.3): only people record the sizing a
      // quote relies on. The principal is given every grant the command needs, so the refusal
      // can only come from the people rule.
      for (const command of PEOPLE_ONLY) {
        const base = principalFor(agent, [1]);
        const principal = {
          ...base,
          permissions: [
            ...base.permissions,
            ...needs(command).map((key) => ({ key, scope: 'all' as const })),
          ],
        };
        const error: unknown = await asPrincipal(principal, (context) =>
          runCommand(command, { context, audit, outbox }, PEOPLE_ONLY_INPUTS[command.name]),
        ).then(
          () => undefined,
          (e: unknown) => e,
        );
        expect({ command: command.name, error }).toMatchObject({
          command: command.name,
          error: { code: 'forbidden', details: { reason: 'people_only' } },
        });
        expect({ command: command.name, stage: failureOf(error)?.stage }).toEqual({
          command: command.name,
          stage: 'guard',
        });
      }
    });

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
