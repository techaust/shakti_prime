import {
  AGENT_FORBIDDEN_PERMISSIONS,
  newId,
  type AgentRoleKey,
  type PermissionKey,
} from '@shakti/contracts';
import { AGENT_MATRIX, asMigrator, asPrincipal, closeDb, principalFor } from '@shakti/db/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { commands } from '../../src/command/registry';
import { failureOf, runCommand } from '../../src/command/run-command';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';

afterAll(closeDb);

/**
 * SECURITY §11 item 3: no agent principal may call a command that needs an admin, cost, audit,
 * integrations, tax-rate, price or catalogue permission (SECURITY §3.3: agents make no price
 * edits). The commands are read from the registry, so a new one that needs such a permission is
 * covered the day it is registered.
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
  'integrations.dlq.replay': { eventId: newId() },
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

describe('agent principals cannot call admin, cost, audit, integrations, tax, price or catalogue commands', () => {
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

  it('no agent in the matrix holds a restricted permission', () => {
    for (const agent of AGENTS) {
      const held = AGENT_MATRIX[agent].map((g) => g.key).filter(isRestricted);
      expect({ agent, held }).toEqual({ agent, held: [] });
    }
  });

  it('no agent role in the seeded database holds a restricted permission', async () => {
    // The matrix above is the seed's source; this reads what the seed actually wrote.
    const rows = await asMigrator(
      (m) => m<{ role: string; permission: PermissionKey }[]>`
        select r.key as role, rp.permission_key as permission
          from role_permissions rp
          join roles r on r.id = rp.role_id
         where r.key like 'agent:%'
         order by r.key, rp.permission_key`,
    );
    expect(new Set(rows.map((r) => r.role))).toEqual(new Set(AGENTS));
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

  for (const agent of AGENTS) {
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
