import { asPrincipal, closeDb, createTestPrincipal, principalFor } from '@shakti/db/testing';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { runCommand } from '../../src/command/run-command';
import { updateEntity } from '../../src/commands/org/update-entity';
import { listEntities } from '../../src/queries/org/list-entities';

afterAll(closeDb);

describe('org.entity.update', () => {
  it('is denied for a General Manager', async () => {
    const gm = principalFor('general_manager', [1]);
    await expect(
      asPrincipal(gm, (context) =>
        runCommand(updateEntity, { context }, { entityId: 1, brandName: 'Shakti Supreme Solar' }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('answers not_found for an entity outside the request scope', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(
          updateEntity,
          { context },
          { entityId: 2, brandName: 'Shakti Motor Pumps Jaipur' },
        ),
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rejects an input that changes nothing or has a bad UPI id', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    await expect(
      asPrincipal(exec, (context) => runCommand(updateEntity, { context }, { entityId: 1 })),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(updateEntity, { context }, { entityId: 1, upiId: 'not a upi id' }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('updates an entity in scope, audits, emits and returns only the DTO', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    const onAudit = vi.fn();
    const onEmit = vi.fn();
    const dto = await asPrincipal(exec, (context) =>
      runCommand(
        updateEntity,
        { context, onAudit, onEmit },
        { entityId: 1, brandName: 'Shakti Supreme Solar' },
      ),
    );
    expect(dto).toEqual({
      id: 1,
      code: 'SS',
      legalName: 'Shakti Supreme',
      brandName: 'Shakti Supreme Solar',
      stateCode: '08',
      gstin: null,
      upiId: null,
    });
    expect(onAudit).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'org.entity.update', principalId: exec.id }),
    );
    expect(onEmit).toHaveBeenCalledWith([
      expect.objectContaining({ type: 'org.entity.updated', entityId: 1 }),
    ]);

    const restored = await asPrincipal(exec, (context) =>
      runCommand(updateEntity, { context }, { entityId: 1, brandName: 'Shakti Supreme' }),
    );
    expect(restored.brandName).toBe('Shakti Supreme');
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
