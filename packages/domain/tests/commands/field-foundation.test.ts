import { newId } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestUser,
} from '@shakti/db/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { runCommand } from '../../src/command/run-command';
import { setFeatureFlag } from '../../src/commands/admin/set-feature-flag';
import { revokeMobileDevice } from '../../src/commands/field/revoke-device';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { listMobileDevices } from '../../src/queries/field/devices';
import { readFeatureFlags } from '../../src/queries/field/feature-flags';

// F1 (docs/03-roadmap-appendix/phase4.md §6.4): the feature flags an Executive switches, and a
// phone signed out of the field app from Admin › Team members.

afterAll(closeDb);

const flagKey = () => `test.flag_${newId().slice(-8).replaceAll('-', '')}`;

/** A signed-in phone of a person, as the auth module writes it. */
async function phone(userId: string): Promise<string> {
  const id = newId();
  const hash = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(
    '',
  );
  await asMigrator(
    (m) => m`insert into mobile_devices (id, user_id, device_id, name, app_version,
               refresh_token_hash, refresh_family_id, refresh_expires_at, signed_in_at)
             values (${id}, ${userId}, ${newId()}, 'Galaxy M14', '1.0.0', ${hash}, ${newId()},
                     now() + interval '30 days', now())`,
  );
  return id;
}

async function auditRows(aggregateId: string): Promise<{ command: string; outcome: string }[]> {
  return asMigrator(
    (m) => m<{ command: string; outcome: string }[]>`
      select command, outcome from audit_logs where aggregate_id = ${aggregateId}`,
  );
}

describe('admin.flag.set', () => {
  it('is refused without admin.flags.write: forbidden for a General Manager', async () => {
    const gm = await createTestPrincipal('general_manager', [1]);
    await expect(
      asPrincipal(gm, (context) =>
        runCommand(setFeatureFlag, { context, audit, outbox }, {
          key: flagKey(),
          entityId: 1,
          enabled: true,
        }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a company outside the request: forbidden for entityId 2 in a request for company 1', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(setFeatureFlag, { context, audit, outbox }, {
          key: flagKey(),
          entityId: 2,
          enabled: true,
        }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('switches a flag for the group and for one company, the company winning there', async () => {
    const exec = await createTestPrincipal('executive');
    const key = flagKey();
    const set = (entityId: number | null, enabled: boolean) =>
      asPrincipal(exec, (context) =>
        runCommand(setFeatureFlag, { context, audit, outbox }, { key, entityId, enabled }),
      );
    const group = await set(null, true);
    expect(group).toMatchObject({ key, entityId: null, enabled: true });
    const one = await set(1, false);
    expect(one).toMatchObject({ key, entityId: 1, enabled: false });
    // a second switch changes the same row
    expect(await set(null, false)).toMatchObject({ id: group.id, enabled: false });
    expect(await set(null, true)).toMatchObject({ id: group.id, enabled: true });

    const engineer = await createTestPrincipal('field_engineer', [1]);
    const inOne = await asPrincipal(engineer, (ctx) => readFeatureFlags(ctx));
    expect(inOne[key]).toBe(false);
    const caller = await createTestPrincipal('tele_caller_cc', [2]);
    expect((await asPrincipal(caller, (ctx) => readFeatureFlags(ctx)))[key]).toBe(true);
    expect(await auditRows(group.id)).toEqual([
      { command: 'admin.flag.set', outcome: 'ok' },
      { command: 'admin.flag.set', outcome: 'ok' },
      { command: 'admin.flag.set', outcome: 'ok' },
    ]);
  });
});

describe('field.device.revoke', () => {
  it('is refused without field.device.revoke: forbidden for a tele-caller and a field engineer', async () => {
    const person = await createTestUser([{ entityId: 1, roleKey: 'field_engineer' }]);
    const id = await phone(person.id);
    for (const roleKey of ['tele_caller_cc', 'field_engineer'] as const) {
      const principal = await createTestPrincipal(roleKey, [1]);
      await expect(
        asPrincipal(principal, (context) =>
          runCommand(revokeMobileDevice, { context, audit, outbox }, { id }),
        ),
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
  });

  it('cannot reach the phone of a person who works only in another company', async () => {
    const elsewhere = await createTestUser([{ entityId: 2, roleKey: 'field_engineer' }]);
    const id = await phone(elsewhere.id);
    const gm = await createTestPrincipal('general_manager', [1]);
    await expect(
      asPrincipal(gm, (context) => runCommand(revokeMobileDevice, { context, audit, outbox }, { id })),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'device_missing' } });
    const [row] = await asMigrator(
      (m) => m<{ revoked_at: Date | null }[]>`select revoked_at from mobile_devices where id = ${id}`,
    );
    expect(row?.revoked_at).toBeNull();
  });

  it('signs the phone of a person of the company out, once, and lists it as signed out', async () => {
    const person = await createTestUser([{ entityId: 1, roleKey: 'field_engineer' }]);
    const id = await phone(person.id);
    const pm = await createTestPrincipal('project_manager', [1]);
    const result = await asPrincipal(pm, (context) =>
      runCommand(revokeMobileDevice, { context, audit, outbox }, { id }),
    );
    expect(result).toMatchObject({ id, userId: person.id });
    await expect(
      asPrincipal(pm, (context) => runCommand(revokeMobileDevice, { context, audit, outbox }, { id })),
    ).rejects.toMatchObject({ code: 'not_found' });
    const [row] = await asMigrator(
      (m) => m<{ reason: string; by: string }[]>`
        select revoked_reason as reason, revoked_by as by from mobile_devices where id = ${id}`,
    );
    expect(row).toEqual({ reason: 'revoked', by: pm.id });
    expect(await auditRows(id)).toEqual([{ command: 'field.device.revoke', outcome: 'ok' }]);

    const listed = await asPrincipal(pm, (ctx) => listMobileDevices(ctx, { userId: person.id }));
    expect(listed).toEqual([
      expect.objectContaining({ id, name: 'Galaxy M14', revokedReason: 'revoked' }),
    ]);
    expect(Object.keys(listed[0] ?? {})).not.toContain('refreshTokenHash');
  });

  it('lists phones only for a holder of field.device.revoke', async () => {
    const person = await createTestUser([{ entityId: 1, roleKey: 'field_engineer' }]);
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    await expect(
      asPrincipal(caller, (ctx) => listMobileDevices(ctx, { userId: person.id })),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
