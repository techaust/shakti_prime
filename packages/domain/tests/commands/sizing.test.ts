import { newId, SizingDto, type Principal, type RecordSizingInput } from '@shakti/contracts';
import {
  asMigrator,
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { createLead } from '../../src/commands/crm/create-lead';
import { recordSizing } from '../../src/commands/crm/record-sizing';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { listSizingPumps } from '../../src/queries/catalogue/list-sizing-pumps';
import { latestSizing } from '../../src/queries/crm/latest-sizing';
import { SIZING_ENGINE_VERSION, sizePump, sizeRooftop } from '../../src/sizing';

afterAll(closeDb);

let teamId: string;
let otherTeamId: string;
let caller: Principal;
let gm: Principal;
/** A pump on sale with a two-point curve: 12,000 litres an hour at 30 m, 8,000 at 50 m. */
let pumpId: string;
/** A pump no longer on sale. */
let retiredPumpId: string;

beforeAll(async () => {
  teamId = await createTestTeam(1, 'sizing team');
  otherTeamId = await createTestTeam(1, 'sizing other team');
  caller = await createTestPrincipal('tele_caller_cc', [1], { teamId });
  gm = await createTestPrincipal('general_manager', [1]);
  pumpId = newId();
  retiredPumpId = newId();
  await asMigrator(async (m) => {
    await m.begin(async (tx) => {
      await tx`insert into items (id, sku, name, category, hsn) values
        (${pumpId}, ${`SZ-${pumpId}`}, 'sizing test pump', 'pump', '8413'),
        (${retiredPumpId}, ${`SZ-${retiredPumpId}`}, 'sizing test retired pump', 'pump', '8413')`;
      await tx`update items set is_active = false where id = ${retiredPumpId}`;
      await tx`insert into pump_curves (id, item_id, head_m, flow_lph) values
        (${newId()}, ${pumpId}, 30.00, 12000.00), (${newId()}, ${pumpId}, 50.00, 8000.00)`;
    });
  });
});

function run(principal: Principal, command: AnyCommand, input: unknown): Promise<unknown> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  );
}

function latest(principal: Principal, input: unknown) {
  return asPrincipal(principal, (context) => latestSizing(context, input));
}

/** A lead of entity 1 owned by `owner`, with a site. */
async function newLead(owner: Principal = caller): Promise<string> {
  const lead = await run(owner, createLead, {
    entityId: 1,
    pipelineKey: 'farmer_pumps',
    contact: {
      name: 'Sizing test customer',
      phone: `97${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
    },
    account: { type: 'farm' },
    site: { type: 'borewell', village: 'Sizing test village', pin: '422001' },
  });
  return (lead as { id: string }).id;
}

/** The field measurements of head worked example 1 (`head.test.ts`), on a solar drive. */
const PUMP_INPUTS = {
  pumpType: 'submersible',
  drive: 'solar',
  pipeMaterial: 'hdpe',
  staticLevelM: 30,
  drawdownM: 5,
  deliveryHeightM: 2,
  pipeLengthM: 50,
  pipeInnerDiameterMm: 50,
  flowLph: 18_000,
} as const;

const ROOFTOP_INPUTS = { monthlyUnitsKwh: 300, roofAreaSqm: 40, sanctionedLoadKw: 5 } as const;

function pumpSizing(opportunityId: string, itemId: string | null = null): RecordSizingInput {
  return {
    entityId: 1,
    opportunityId,
    sizing: { kind: 'pump', inputs: { ...PUMP_INPUTS }, itemId },
  };
}

function rooftopSizing(opportunityId: string): RecordSizingInput {
  return { entityId: 1, opportunityId, sizing: { kind: 'rooftop', inputs: { ...ROOFTOP_INPUTS } } };
}

async function stored(id: string) {
  const [row] = await asMigrator(
    (m) => m<
      {
        opportunity_id: string;
        site_id: string | null;
        kind: string;
        item_id: string | null;
        in_bounds: boolean;
        reasons_json: string[];
        engine_version: string;
        created_by: string;
      }[]
    >`select opportunity_id, site_id, kind, item_id, in_bounds, reasons_json, engine_version, created_by
        from sizings where id = ${id}`,
  );
  if (!row) throw new Error(`no sizing ${id}`);
  return row;
}

async function leadSite(opportunityId: string): Promise<string | null> {
  const [row] = await asMigrator(
    (m) => m<{ site_id: string | null }[]>`select site_id from opportunities where id = ${opportunityId}`,
  );
  return row?.site_id ?? null;
}

describe('crm.sizing.record (design §6.7)', () => {
  it('is denied to a role without the lead permissions', async () => {
    const hr = await createTestPrincipal('hr_admin', [1]);
    const id = await newLead();
    await expect(run(hr, recordSizing, pumpSizing(id))).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('refuses a company outside the request and finds no lead of another company', async () => {
    const id = await newLead();
    const elsewhere = await createTestPrincipal('general_manager', [2]);
    const both = await createTestPrincipal('general_manager', [1, 2]);
    await expect(run(elsewhere, recordSizing, pumpSizing(id))).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      run(both, recordSizing, { ...pumpSizing(id), entityId: 2 }),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'lead_missing' } });
  });

  it('finds no lead outside the caller’s own scope', async () => {
    const id = await newLead();
    const stranger = await createTestPrincipal('tele_caller_cc', [1], { teamId: otherTeamId });
    await expect(run(stranger, recordSizing, rooftopSizing(id))).rejects.toMatchObject({
      code: 'not_found',
      details: { reason: 'lead_missing' },
    });
  });

  it('never takes a result from the caller', async () => {
    const id = await newLead();
    const withResult = {
      ...pumpSizing(id),
      sizing: { ...pumpSizing(id).sizing, result: { inBounds: true } },
    };
    await expect(run(caller, recordSizing, withResult)).rejects.toMatchObject({
      code: 'validation_failed',
    });
    const withBounds = { ...rooftopSizing(id), inBounds: true };
    await expect(run(caller, recordSizing, withBounds)).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('records a pump sizing the calculators computed, with the lead’s site, audit and event', async () => {
    const id = await newLead();
    const dto = SizingDto.parse(await run(caller, recordSizing, pumpSizing(id)));
    const expected = sizePump(PUMP_INPUTS, null);

    expect(dto).toMatchObject({
      kind: 'pump',
      opportunityId: id,
      entityId: 1,
      itemId: null,
      inBounds: true,
      reasons: [],
      engineVersion: SIZING_ENGINE_VERSION,
    });
    expect(dto.result).toEqual(expected.result);
    if (dto.kind !== 'pump') throw new Error('a pump sizing');
    // 0.005 m³/s against about 44.39 m is 2.177 kW of water, 3.958 kW (5.31 HP) at the shaft at
    // 0.55: the next rating is 7.5 HP (5.593 kW), and 1.3 times that is 7.27 kWp, 14 modules of 540 Wp.
    expect(dto.result.power.standardHp).toBe(7.5);
    expect(dto.result.solar?.moduleCount).toBe(14);
    expect(dto.result.dutyPoint).toBeNull();

    const row = await stored(dto.id);
    expect(row).toMatchObject({
      opportunity_id: id,
      kind: 'pump',
      item_id: null,
      in_bounds: true,
      reasons_json: [],
      engine_version: SIZING_ENGINE_VERSION,
      created_by: caller.id,
    });
    expect(row.site_id).toBe(await leadSite(id));
    expect(row.site_id).not.toBeNull();

    const audits = await asMigrator(
      (m) => m<{ command: string; after_json: Record<string, unknown> }[]>`
        select command, after_json from audit_logs where aggregate_id = ${dto.id}`,
    );
    expect(audits).toEqual([
      {
        command: 'crm.sizing.record',
        after_json: expect.objectContaining({
          opportunityId: id,
          sizingKind: 'pump',
          inBounds: true,
          sizingReasons: [],
          engineVersion: SIZING_ENGINE_VERSION,
        }),
      },
    ]);

    const events = await asOutboxPublisher(
      (p) => p<{ type: string; entity_id: number; payload_json: Record<string, unknown> }[]>`
        select type, entity_id, payload_json from outbox_events where aggregate_id = ${dto.id}`,
    );
    expect(events).toEqual([
      {
        type: 'crm.sizing.recorded',
        entity_id: 1,
        payload_json: { v: 1, opportunityId: id, kind: 'pump', inBounds: true, reasons: [] },
      },
    ]);
  });

  it('checks the duty point on the chosen pump’s curve', async () => {
    const id = await newLead();
    const dto = SizingDto.parse(await run(caller, recordSizing, pumpSizing(id, pumpId)));
    if (dto.kind !== 'pump') throw new Error('a pump sizing');
    expect(dto.itemId).toBe(pumpId);
    // The head, about 44.39 m, lies between the curve's 30 and 50 m points, so the pump delivers.
    expect(dto.result.dutyPoint).toMatchObject({ inBounds: true, shutoffHeadM: 50, minHeadM: 30 });
    expect(dto.result.dutyPoint?.dutyFlowLph).toBeCloseTo(
      12_000 + ((dto.result.head.tdhM - 30) / 20) * -4_000,
      6,
    );
    expect((await stored(dto.id)).item_id).toBe(pumpId);
  });

  it('records an out-of-bounds result with its reasons rather than refusing it', async () => {
    const id = await newLead();
    // A deeper borewell puts the head above the pump's 50 m shut-off.
    const deep = pumpSizing(id, pumpId);
    if (deep.sizing.kind !== 'pump') throw new Error('a pump sizing');
    deep.sizing.inputs = { ...deep.sizing.inputs, staticLevelM: 60 };
    const dto = SizingDto.parse(await run(caller, recordSizing, deep));
    expect(dto).toMatchObject({ inBounds: false, reasons: ['head_above_shutoff'] });
    expect(await stored(dto.id)).toMatchObject({
      in_bounds: false,
      reasons_json: ['head_above_shutoff'],
    });
    const [event] = await asOutboxPublisher(
      (p) => p<{ payload_json: Record<string, unknown> }[]>`
        select payload_json from outbox_events where aggregate_id = ${dto.id}`,
    );
    expect(event?.payload_json).toMatchObject({ inBounds: false, reasons: ['head_above_shutoff'] });
  });

  it('refuses a pump that is not on sale or not in the catalogue', async () => {
    const id = await newLead();
    for (const itemId of [retiredPumpId, newId()]) {
      await expect(run(caller, recordSizing, pumpSizing(id, itemId))).rejects.toMatchObject({
        code: 'not_found',
        details: { reason: 'sizing_item_missing' },
      });
    }
  });

  it('records a rooftop sizing', async () => {
    const id = await newLead();
    const dto = SizingDto.parse(await run(gm, recordSizing, rooftopSizing(id)));
    expect(dto).toMatchObject({ kind: 'rooftop', itemId: null, inBounds: true, reasons: [] });
    expect(dto.result).toEqual(sizeRooftop(ROOFTOP_INPUTS).result);
  });
});

describe('latestSizing', () => {
  it('answers the newest sizing of a lead, of either kind or of one', async () => {
    const id = await newLead();
    const pump = SizingDto.parse(await run(caller, recordSizing, pumpSizing(id)));
    const rooftop = SizingDto.parse(await run(caller, recordSizing, rooftopSizing(id)));

    expect(await latest(caller, { entityId: 1, opportunityId: id })).toEqual(rooftop);
    expect(await latest(caller, { entityId: 1, opportunityId: id, kind: 'pump' })).toEqual(pump);
    expect(await latest(gm, { entityId: 1, opportunityId: id, kind: 'rooftop' })).toEqual(
      rooftop,
    );

    const again = SizingDto.parse(await run(caller, recordSizing, pumpSizing(id, pumpId)));
    expect(await latest(caller, { entityId: 1, opportunityId: id, kind: 'pump' })).toEqual(again);
  });

  it('answers null for a lead with no sizing, or one the caller cannot read', async () => {
    const id = await newLead();
    expect(await latest(caller, { entityId: 1, opportunityId: id })).toBeNull();
    await run(caller, recordSizing, rooftopSizing(id));
    const stranger = await createTestPrincipal('tele_caller_cc', [1], { teamId: otherTeamId });
    expect(await latest(stranger, { entityId: 1, opportunityId: id })).toBeNull();
  });

  it('is refused without the lead permission or outside the request’s companies', async () => {
    const id = await newLead();
    const hr = await createTestPrincipal('hr_admin', [1]);
    await expect(latest(hr, { entityId: 1, opportunityId: id })).rejects.toMatchObject({
      code: 'forbidden',
    });
    const elsewhere = await createTestPrincipal('general_manager', [2]);
    await expect(latest(elsewhere, { entityId: 1, opportunityId: id })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(latest(gm, { entityId: 1, opportunityId: 'not an id' })).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });
});

describe('listSizingPumps', () => {
  it('offers the pumps on sale that have a curve, and no other item', async () => {
    const noCurve = newId();
    await asMigrator(
      (m) => m`insert into items (id, sku, name, category, hsn)
                 values (${noCurve}, ${`SZ-${noCurve}`}, 'sizing test pump with no curve', 'pump', '8413')`,
    );
    const pumps = await asPrincipal(caller, (context) => listSizingPumps(context));
    const ids = pumps.map((p) => p.id);
    expect(pumps).toContainEqual({ id: pumpId, sku: `SZ-${pumpId}`, name: 'sizing test pump' });
    expect(ids).not.toContain(retiredPumpId);
    expect(ids).not.toContain(noCurve);
  });

  it('is refused without the lead permission', async () => {
    const hr = await createTestPrincipal('hr_admin', [1]);
    await expect(asPrincipal(hr, (context) => listSizingPumps(context))).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});
