import { newId } from '@shakti/contracts';
import {
  asMigrator,
  closeDb,
  createTestPrincipal,
  createTestUser,
  principalFor,
} from '@shakti/db/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../../src/command/execute';
import { inviteUser } from '../../src/commands/admin/invite-user';
import { createLead } from '../../src/commands/crm/create-lead';
import { updateEntity } from '../../src/commands/org/update-entity';
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
