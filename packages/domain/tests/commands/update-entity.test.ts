import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit, memoryAuditSink } from '../../src/audit/sink';
import { databaseOutboxSink as outbox, memoryOutboxSink } from '../../src/outbox/sink';
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
          { context, audit, outbox },
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
          { context, audit, outbox },
          { entityId: 2, brandName: 'Shakti Motor Pumps Jaipur' },
        ),
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rejects an input that changes nothing or has a bad UPI id', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(updateEntity, { context, audit, outbox }, { entityId: 1 }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(
          updateEntity,
          { context, audit, outbox },
          { entityId: 1, upiId: 'not a upi id' },
        ),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('updates an entity in scope, audits, emits and returns only the DTO', async () => {
    // Entity 1 is shared seed data that an Executive may have edited (GSTIN, UPI); the test
    // asserts relative to what is there and puts the brand name back even if it fails.
    const [before] = await asMigrator(
      (m) =>
        m<
          {
            brand_name: string;
            gstin: string | null;
            upi_id: string | null;
            address_line1: string | null;
            address_line2: string | null;
            city: string | null;
            pin: string | null;
            bank_details_set: boolean;
          }[]
        >`select brand_name, gstin, upi_id, address_line1, address_line2, city, pin,
                 bank_details_set
            from entities where id = 1`,
    );
    if (!before) throw new Error('entity 1 is seeded');
    const exec = await createTestPrincipal('executive', [1]);
    const recorded = memoryAuditSink();
    const emitted = memoryOutboxSink();
    try {
      const dto = await asPrincipal(exec, (context) =>
        runCommand(
          updateEntity,
          { context, audit: recorded, outbox: emitted },
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
        addressLine1: before.address_line1,
        addressLine2: before.address_line2,
        city: before.city,
        pin: before.pin,
        bankDetailsSet: before.bank_details_set,
      });
      expect(recorded.records).toContainEqual(
        expect.objectContaining({
          command: 'org.entity.update',
          actorPrincipalId: exec.id,
          outcome: 'ok',
        }),
      );
      expect(emitted.records).toEqual([
        expect.objectContaining({ type: 'org.entity.updated', entityId: 1 }),
      ]);
    } finally {
      await asMigrator(
        (m) => m`update entities set brand_name = ${before.brand_name} where id = 1`,
      );
    }
  });
});

describe('org.entity.update: GSTIN and registered address (workshop pack SALE-2)', () => {
  const run = (input: Record<string, unknown>) =>
    createTestPrincipal('executive', [1]).then((exec) =>
      asPrincipal(exec, (context) =>
        runCommand(updateEntity, { context, audit, outbox }, { entityId: 1, ...input }),
      ),
    );

  it('refuses a GSTIN in the wrong shape, of an unknown state, or of another state', async () => {
    await expect(run({ gstin: '08ABCDE1234F1Z' })).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await expect(run({ gstin: '99ABCDE1234F1Z5' })).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await expect(run({ stateCode: '39' })).rejects.toMatchObject({ code: 'validation_failed' });
    // Sent together, the two must agree; the input check refuses them before the command runs.
    await expect(run({ gstin: '27ABCDE1234F1Z5', stateCode: '08' })).rejects.toMatchObject({
      code: 'validation_failed',
      details: { issues: [expect.objectContaining({ path: 'gstin' })] },
    });
    // Sent alone, the GSTIN is checked against the state code the company already has (08).
    await expect(run({ gstin: '27ABCDE1234F1Z5' })).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'gstin_state_mismatch' },
    });
    await expect(run({ pin: '012345' })).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('records the GSTIN and address, in capitals and trimmed, and audits what changed', async () => {
    const [before] = await asMigrator(
      (m) =>
        m<
          {
            gstin: string | null;
            state_code: string;
            address_line1: string | null;
            address_line2: string | null;
            city: string | null;
            pin: string | null;
          }[]
        >`select gstin, state_code, address_line1, address_line2, city, pin
            from entities where id = 1`,
    );
    if (!before) throw new Error('entity 1 is seeded');
    const exec = await createTestPrincipal('executive', [1]);
    const recorded = memoryAuditSink();
    const emitted = memoryOutboxSink();
    try {
      const dto = await asPrincipal(exec, (context) =>
        runCommand(
          updateEntity,
          { context, audit: recorded, outbox: emitted },
          {
            entityId: 1,
            gstin: ' 08abcde1234f1z5 ',
            addressLine1: 'Plot 14, Industrial Area',
            addressLine2: null,
            city: 'Jaipur',
            pin: '302013',
          },
        ),
      );
      expect(dto).toMatchObject({
        gstin: '08ABCDE1234F1Z5',
        stateCode: before.state_code,
        addressLine1: 'Plot 14, Industrial Area',
        addressLine2: null,
        city: 'Jaipur',
        pin: '302013',
      });
      expect(recorded.records).toEqual([
        expect.objectContaining({
          command: 'org.entity.update',
          entityId: 1,
          before: {
            gstin: before.gstin,
            addressLine1: before.address_line1,
            addressLine2: before.address_line2,
            city: before.city,
            pin: before.pin,
          },
          after: {
            gstin: '08ABCDE1234F1Z5',
            addressLine1: 'Plot 14, Industrial Area',
            addressLine2: null,
            city: 'Jaipur',
            pin: '302013',
          },
        }),
      ]);
      expect(emitted.records).toEqual([
        expect.objectContaining({
          type: 'org.entity.updated',
          payload: { fields: ['gstin', 'addressLine1', 'addressLine2', 'city', 'pin'], v: 1 },
        }),
      ]);
    } finally {
      await asMigrator(
        (m) => m`update entities
          set gstin = ${before.gstin}, address_line1 = ${before.address_line1},
              address_line2 = ${before.address_line2}, city = ${before.city}, pin = ${before.pin}
          where id = 1`,
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
        'addressLine1',
        'addressLine2',
        'bankDetailsSet',
        'brandName',
        'city',
        'code',
        'gstin',
        'id',
        'legalName',
        'pin',
        'stateCode',
        'upiId',
      ]);
  });
});
