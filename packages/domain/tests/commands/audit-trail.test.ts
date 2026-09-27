import { newId } from '@shakti/contracts';
import {
  asMigrator,
  closeDb,
  createTestPrincipal,
  createTestUser,
  principalFor,
  roleId,
  tierId,
} from '@shakti/db/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../../src/command/execute';
import { inviteUser } from '../../src/commands/admin/invite-user';
import { revokeSession } from '../../src/commands/admin/revoke-session';
import { setUserRoles } from '../../src/commands/admin/set-user-roles';
import { reactivateUser, suspendUser } from '../../src/commands/admin/user-status';
import { createLead } from '../../src/commands/crm/create-lead';
import { updateEntity } from '../../src/commands/org/update-entity';
import { setPrice } from '../../src/commands/pricing/set-price';
import { setTheme } from '../../src/commands/profile/set-theme';
import { memoryLogger } from '../../src/ports/logger';

afterAll(closeDb);

interface Row {
  command: string;
  outcome: string;
  entity_id: number | null;
  actor_principal_id: string | null;
  actor_kind: string | null;
  aggregate_type: string | null;
  aggregate_id: string | null;
  error_code: string | null;
  input_json: unknown;
  before_json: unknown;
  after_json: unknown;
  ip: string | null;
  device: string | null;
  request_id: string | null;
}

/** The rows one request left, read as the table owner so no policy hides any of them. */
function rowsOf(requestId: string): Promise<Row[]> {
  return asMigrator(
    (m) => m<Row[]>`
      select command, outcome, entity_id, actor_principal_id, actor_kind, aggregate_type,
             aggregate_id, error_code, input_json, before_json, after_json, host(ip) as ip,
             device, request_id
        from audit_logs where request_id = ${requestId} order by created_at, id
    `,
  );
}

const client = { ip: '203.0.113.7', device: 'Mozilla/5.0 (Linux; Android 14)' };

describe('the audit row of a command that commits (docs/design/backend-weeks-3-5.md §3.2)', () => {
  it('records caller, company, before and after, address, device and request', async () => {
    const exec = await createTestPrincipal('executive');
    const [before] = await asMigrator(
      (m) => m<{ brand_name: string }[]>`select brand_name from entities where id = 1`,
    );
    if (!before) throw new Error('entity 1 is seeded');
    const requestId = newId();
    try {
      await executeCommand(
        exec,
        { entityIds: [1], requestId },
        updateEntity,
        { entityId: 1, brandName: `${before.brand_name} Pumps` },
        { client },
      );
      expect(await rowsOf(requestId)).toEqual([
        {
          command: 'org.entity.update',
          outcome: 'ok',
          entity_id: 1,
          actor_principal_id: exec.id,
          actor_kind: 'user',
          aggregate_type: 'entity',
          aggregate_id: '1',
          error_code: null,
          input_json: { entityId: 1, brandName: `${before.brand_name} Pumps` },
          before_json: { brandName: before.brand_name },
          after_json: { brandName: `${before.brand_name} Pumps` },
          ip: client.ip,
          device: client.device,
          request_id: requestId,
        },
      ]);
    } finally {
      await asMigrator(
        (m) => m`update entities set brand_name = ${before.brand_name} where id = 1`,
      );
    }
  });

  it('masks the phone of a new lead and names the opportunity', async () => {
    const cc = await createTestPrincipal('tele_caller_cc', [1]);
    const requestId = newId();
    const lead = await executeCommand(cc, { entityIds: [1], requestId }, createLead, {
      entityId: 1,
      pipelineKey: 'farmer_pumps',
      contact: { name: 'Audit trail contact', phone: '98765 43210' },
      account: { type: 'farm' },
    });
    const [row] = await rowsOf(requestId);
    expect(row).toMatchObject({
      command: 'crm.lead.create',
      outcome: 'ok',
      entity_id: 1,
      aggregate_type: 'opportunity',
      aggregate_id: lead.id,
      input_json: { contact: { name: 'Audit trail contact' } },
      after_json: { ownerId: cc.id },
    });
    expect(JSON.stringify(row)).not.toContain('98765');
    expect((row?.input_json as { contact: { phone: string } }).contact.phone).toMatch(/\*+3210$/);
  });

  it('keeps an invited person’s email to its last four characters', async () => {
    const exec = await createTestPrincipal('executive');
    const email = `audit-${newId().slice(-12)}@shakti.test`;
    const requestId = newId();
    const user = await executeCommand(exec, { requestId }, inviteUser, {
      email,
      displayName: 'Audit trail invitee',
      phone: '+919812345678',
      entityRoles: [{ entityId: 1, roleKey: 'tele_caller_cc' }],
    });
    const [row] = await rowsOf(requestId);
    expect(row).toMatchObject({
      command: 'admin.user.invite',
      entity_id: null,
      aggregate_type: 'user',
      aggregate_id: user.id,
      after_json: { status: 'invited', displayName: 'Audit trail invitee' },
    });
    const text = JSON.stringify(row);
    expect(text).not.toContain(email);
    expect(text).not.toContain('9812345678');
    expect(text).toContain('"email":"********test"');
  });

  it('records a theme change against the person, not a company', async () => {
    const user = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc' }]);
    const me = principalFor('tele_caller_cc', [1], { id: user.id });
    const requestId = newId();
    await executeCommand(me, { entityIds: [1], requestId }, setTheme, { theme: 'dark' });
    expect(await rowsOf(requestId)).toMatchObject([
      {
        command: 'profile.theme.set',
        entity_id: null,
        aggregate_id: user.id,
        before_json: { theme: 'system' },
        after_json: { theme: 'dark' },
      },
    ]);
  });
});

describe('the audit row of a call that does not commit', () => {
  it('records a refusal by the permission guard, and nothing changes', async () => {
    const cc = await createTestPrincipal('tele_caller_cc', [1]);
    const requestId = newId();
    await expect(
      executeCommand(
        cc,
        { entityIds: [1], requestId },
        updateEntity,
        { entityId: 1, brandName: 'Not allowed' },
        { client },
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await rowsOf(requestId)).toEqual([
      expect.objectContaining({
        command: 'org.entity.update',
        outcome: 'denied',
        entity_id: 1,
        actor_principal_id: cc.id,
        error_code: 'forbidden',
        input_json: { entityId: 1, brandName: 'Not allowed' },
        before_json: null,
        after_json: null,
        ip: client.ip,
      }),
    ]);
    const [entity] = await asMigrator(
      (m) => m<{ brand_name: string }[]>`select brand_name from entities where id = 1`,
    );
    expect(entity?.brand_name).not.toBe('Not allowed');
  });

  it('records a failure inside the command, without the change it rolled back', async () => {
    const exec = await createTestPrincipal('executive');
    const requestId = newId();
    await expect(
      executeCommand(exec, { entityIds: [1], requestId }, updateEntity, { entityId: 1 }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(await rowsOf(requestId)).toEqual([
      expect.objectContaining({
        outcome: 'failed',
        error_code: 'validation_failed',
        entity_id: 1,
        input_json: { entityId: 1 },
        before_json: null,
        after_json: null,
      }),
    ]);
  });

  it('records a request for companies outside the caller’s access', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    const requestId = newId();
    await expect(
      executeCommand(exec, { entityIds: [2], requestId }, updateEntity, {
        entityId: 2,
        brandName: 'Outside access',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await rowsOf(requestId)).toEqual([
      expect.objectContaining({ outcome: 'denied', entity_id: null, error_code: 'forbidden' }),
    ]);
  });

  it('records nothing for input that does not parse', async () => {
    const exec = await createTestPrincipal('executive');
    const requestId = newId();
    await expect(
      executeCommand(exec, { requestId }, updateEntity, { entityId: 'one' }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(await rowsOf(requestId)).toEqual([]);
  });

  it('never hides the original refusal when its audit row cannot be written', async () => {
    // A principal with no `principals` row: the refusal row fails its foreign key.
    const ghost = principalFor('tele_caller_cc', [1]);
    const logger = memoryLogger();
    const requestId = newId();
    await expect(
      executeCommand(
        ghost,
        { entityIds: [1], requestId },
        updateEntity,
        { entityId: 1, brandName: 'Ghost' },
        { logger },
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(logger.entries).toEqual([
      expect.objectContaining({ level: 'error', event: 'audit.write_failed' }),
    ]);
    expect(await rowsOf(requestId)).toEqual([]);
  });
});

/** A live session row for a user, as the auth module would write it. */
async function addSession(userId: string): Promise<string> {
  const id = newId();
  await asMigrator(
    (m) => m`insert into sessions (id, user_id, token, expires_at)
      values (${id}, ${userId}, ${`tok-${id}`}, now() + interval '12 hours')`,
  );
  return id;
}

describe('the before and after of every admin and pricing command', () => {
  it('admin.user.role.set records the access list it replaced and the one it set', async () => {
    const exec = await createTestPrincipal('executive');
    const target = await createTestUser([{ entityId: 1, roleKey: 'accounts' }]);
    await addSession(target.id);
    const requestId = newId();
    await executeCommand(exec, { requestId }, setUserRoles, {
      userId: target.id,
      entityRoles: [{ entityId: 1, roleKey: 'store_manager' }],
    });
    expect(await rowsOf(requestId)).toEqual([
      expect.objectContaining({
        command: 'admin.user.role.set',
        outcome: 'ok',
        entity_id: null,
        aggregate_type: 'user',
        aggregate_id: target.id,
        before_json: { entityRoles: [{ entityId: 1, roleId: roleId('accounts'), teamId: null }] },
        after_json: {
          entityRoles: [{ entityId: 1, roleId: roleId('store_manager'), teamId: null }],
          revokedSessions: 1,
        },
      }),
    ]);
  });

  it('admin.user.suspend and reactivate record the status either side, and a repeat changes nothing', async () => {
    const exec = await createTestPrincipal('executive');
    const target = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc' }]);
    await addSession(target.id);
    const suspended = newId();
    await executeCommand(exec, { requestId: suspended }, suspendUser, {
      userId: target.id,
      reason: 'left the company',
    });
    expect(await rowsOf(suspended)).toEqual([
      expect.objectContaining({
        command: 'admin.user.suspend',
        aggregate_id: target.id,
        input_json: { userId: target.id, reason: 'left the company' },
        before_json: { status: 'active' },
        after_json: { status: 'suspended', revokedSessions: 1 },
      }),
    ]);

    const repeated = newId();
    await executeCommand(exec, { requestId: repeated }, suspendUser, { userId: target.id });
    expect(await rowsOf(repeated)).toEqual([
      expect.objectContaining({
        command: 'admin.user.suspend',
        outcome: 'ok',
        aggregate_id: target.id,
        before_json: null,
        after_json: null,
      }),
    ]);

    const reactivated = newId();
    await executeCommand(exec, { requestId: reactivated }, reactivateUser, { userId: target.id });
    expect(await rowsOf(reactivated)).toEqual([
      expect.objectContaining({
        command: 'admin.user.reactivate',
        aggregate_id: target.id,
        before_json: { status: 'suspended' },
        after_json: { status: 'active' },
      }),
    ]);
  });

  it('admin.session.revoke records the session it ended, never its secret', async () => {
    const exec = await createTestPrincipal('executive');
    const target = await createTestUser([{ entityId: 2, roleKey: 'store_manager' }]);
    const sessionId = await addSession(target.id);
    const requestId = newId();
    await executeCommand(exec, { requestId }, revokeSession, { sessionId });
    const rows = await rowsOf(requestId);
    expect(rows).toEqual([
      expect.objectContaining({
        command: 'admin.session.revoke',
        entity_id: null,
        aggregate_type: 'session',
        aggregate_id: sessionId,
        before_json: { userId: target.id, revokedAt: null },
        after_json: expect.objectContaining({
          userId: target.id,
          revokedReason: 'admin',
        }) as unknown,
      }),
    ]);
    expect((rows[0]?.after_json as { revokedAt: string }).revokedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.stringify(rows)).not.toContain(`tok-${sessionId}`);
  });

  it('pricing.price.set records the old price, the new one and the reason, on the company of the list', async () => {
    const tag = newId().slice(-12);
    const item = newId();
    const list = newId();
    await asMigrator((m) =>
      m.begin(async (tx) => {
        await tx`insert into items (id, sku, name, category, hsn)
          values (${item}, ${`T-${tag}-AUD`}, 'audit trail item', 'pump', '8413')`;
        await tx`insert into price_lists (id, tier_id, entity_id, version, effective_from)
          values (${list}, ${tierId('commercial')}, 2, ${Math.floor(Math.random() * 1_000_000_000)}, '2026-04-01')`;
      }),
    );
    try {
      const exec = await createTestPrincipal('executive');
      const first = newId();
      const priced = await executeCommand(exec, { entityIds: [2], requestId: first }, setPrice, {
        priceListId: list,
        itemId: item,
        price: '1500.00',
      });
      expect(await rowsOf(first)).toEqual([
        expect.objectContaining({
          command: 'pricing.price.set',
          entity_id: 2,
          aggregate_type: 'price_list_item',
          aggregate_id: priced.id,
          before_json: null,
          after_json: {
            priceListId: list,
            itemId: item,
            kitId: null,
            price: '1500.00',
            reason: null,
          },
        }),
      ]);

      const second = newId();
      await executeCommand(exec, { entityIds: [2], requestId: second }, setPrice, {
        priceListId: list,
        itemId: item,
        price: '1650.00',
        reason: 'supplier increase',
      });
      expect(await rowsOf(second)).toEqual([
        expect.objectContaining({
          before_json: { price: '1500.00' },
          after_json: expect.objectContaining({
            price: '1650.00',
            reason: 'supplier increase',
          }) as unknown,
        }),
      ]);
    } finally {
      // Closed, so the next run may open its own list for the same tier (AUDIT M19).
      await asMigrator((m) => m`update price_lists set archived_at = now() where id = ${list}`);
    }
  });
});
