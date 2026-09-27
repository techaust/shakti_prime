import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { databaseAuditSink as audit, memoryAuditSink } from '../../src/audit/sink';
import { runCommand } from '../../src/command/run-command';
import { updateEntity } from '../../src/commands/org/update-entity';
import { listEntities } from '../../src/queries/org/list-entities';

afterAll(closeDb);

describe('org.entity.update', () => {
  it('is denied for a General Manager', async () => {
    const gm = principalFor('general_manager', [1]);
    await expect(
      asPrincipal(gm, (context) =>
        runCommand(
          updateEntity,
          { context, audit },
          { entityId: 1, brandName: 'Shakti Supreme Solar' },
        ),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('answers not_found for an entity outside the request scope', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(
          updateEntity,
          { context, audit },
          { entityId: 2, brandName: 'Shakti Motor Pumps Jaipur' },
        ),
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rejects an input that changes nothing or has a bad UPI id', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    await expect(
      asPrincipal(exec, (context) => runCommand(updateEntity, { context, audit }, { entityId: 1 })),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(updateEntity, { context, audit }, { entityId: 1, upiId: 'not a upi id' }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('updates an entity in scope, audits, emits and returns only the DTO', async () => {
    // Entity 1 is shared seed data that an Executive may have edited (GSTIN, UPI); the test
    // asserts relative to what is there and puts the brand name back even if it fails.
    const [before] = await asMigrator(
      (m) =>
        m<
          { brand_name: string; gstin: string | null; upi_id: string | null }[]
        >`select brand_name, gstin, upi_id from entities where id = 1`,
    );
    if (!before) throw new Error('entity 1 is seeded');
    const exec = await createTestPrincipal('executive', [1]);
    const recorded = memoryAuditSink();
    const onEmit = vi.fn();
    try {
      const dto = await asPrincipal(exec, (context) =>
        runCommand(
          updateEntity,
          { context, audit: recorded, onEmit },
          { entityId: 1, brandName: `${before.brand_name} Solar` },
        ),
      );
      expect(dto).toEqual({
        id: 1,
        code: 'SS',
        legalName: 'Shakti Supreme',
        brandName: `${before.brand_name} Solar`,
        stateCode: '08',
        gstin: before.gstin,
        upiId: before.upi_id,
      });
      expect(recorded.records).toContainEqual(
        expect.objectContaining({
          command: 'org.entity.update',
          actorPrincipalId: exec.id,
          outcome: 'ok',
        }),
      );
      expect(onEmit).toHaveBeenCalledWith([
        expect.objectContaining({ type: 'org.entity.updated', entityId: 1 }),
      ]);
    } finally {
      await asMigrator(
        (m) => m`update entities set brand_name = ${before.brand_name} where id = 1`,
      );
    }
  });
});

describe('listEntities', () => {
  it('returns only the entities in scope, as DTOs', async () => {
    const lc = principalFor('tele_caller_lc', [2, 3]);
    const rows = await asPrincipal(lc, listEntities);
    expect(rows.map((r) => r.id)).toEqual([2, 3]);
    for (const row of rows)
      expect(Object.keys(row).sort()).toEqual([
        'brandName',
        'code',
        'gstin',
        'id',
        'legalName',
        'stateCode',
        'upiId',
      ]);
  });
});
