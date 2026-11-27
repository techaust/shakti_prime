import { newId, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit, memoryAuditSink } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import {
  identifyWarrantySerial,
  raiseWarrantyClaim,
  rejectWarrantyClaim,
  settleWarrantyClaim,
} from '../../src/commands/inventory/warranty';
import { databaseOutboxSink as outbox, memoryOutboxSink } from '../../src/outbox/sink';

afterAll(closeDb);

/**
 * R3's claim commands (docs/03-roadmap-appendix/phase3.md §7.5): raised on a customer or a
 * delivered serial with inventory.warranty.write for the claim's company, the serial in warranty
 * by its date in India, rejected with why, settled by the supplier's credit with
 * procurement.grn.write. No answer, audit row or event carries the credit.
 */

const tag = newId().slice(-8).toUpperCase();
let manager: Principal;
let exec: Principal;
const account = newId();
const otherAccount = newId();
const site = newId();
const item = newId();
const vendor = newId();

interface Claim {
  id: string;
  entityId: number;
  claimNo: string;
  state: string;
}

function run<T = Claim>(
  principal: Principal,
  command: AnyCommand,
  input: unknown,
  now?: Date,
): Promise<T> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox, ...(now ? { now } : {}) }, input),
  ) as Promise<T>;
}

let serialSeq = 0;
/** A serial of company 1's pump, in the state given, delivered to `owner` with its warranty date. */
async function serial(
  warrantyUntil: string | null,
  options: { state?: string; owner?: string | null; site?: string | null; entityId?: number } = {},
): Promise<string> {
  const id = newId();
  serialSeq += 1;
  const state = options.state ?? 'with_customer';
  await asMigrator(
    (
      m,
    ) => m`insert into serials (id, entity_id, item_id, serial_no, state, account_id, site_id, warranty_until, created_by)
      values (${id}, ${options.entityId ?? 1}, ${item}, ${`WS-${tag}-${String(serialSeq)}`}, ${state},
              ${options.owner === undefined ? account : options.owner}, ${options.site ?? null},
              ${warrantyUntil}, ${exec.id})`,
  );
  return id;
}

beforeAll(async () => {
  exec = await createTestPrincipal('executive');
  manager = await createTestPrincipal('inventory_manager', [1]);
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into accounts (id, type, name, created_by) values
        (${account}, 'farm', ${`Warranty farm ${tag}`}, ${exec.id}),
        (${otherAccount}, 'farm', ${`Warranty other ${tag}`}, ${exec.id})`;
      await tx`insert into account_entities (id, account_id, entity_id, created_by) values
        (${newId()}, ${account}, 1, ${exec.id}),
        (${newId()}, ${otherAccount}, 1, ${exec.id}),
        (${newId()}, ${otherAccount}, 2, ${exec.id})`;
      await tx`insert into customer_sites (id, account_id, type, village, created_by)
        values (${site}, ${account}, 'borewell', 'Chomu', ${exec.id})`;
      await tx`insert into items (id, sku, name, category, hsn, unit, is_serial_tracked, is_active)
        values (${item}, ${`WP-${tag}`}, ${`Warranty pump ${tag}`}, 'pump', '8413', 'nos', true, true)`;
      await tx`insert into vendors (id, name, created_by) values (${vendor}, ${`Warranty vendor ${tag}`}, ${exec.id})`;
    }),
  );
});

describe('inventory.warranty.raise', () => {
  const onCustomer = (entityId = 1) => ({
    entityId,
    accountId: account,
    reportedFault: 'The pump stopped after two days',
  });

  it('is refused without inventory.warranty.write for the company, and to every agent', async () => {
    for (const roleKey of [
      'general_manager',
      'store_manager',
      'accounts',
      'tele_caller_lc',
    ] as const) {
      await expect(
        run(principalFor(roleKey, [1]), raiseWarrantyClaim, onCustomer()),
        roleKey,
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
    await expect(
      run(principalFor('agent:chief', [1]), raiseWarrantyClaim, onCustomer()),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // The Inventory Manager of company 1, for company 2.
    await expect(run(manager, raiseWarrantyClaim, onCustomer(2))).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('raises a numbered claim on a customer of the company, audited and announced', async () => {
    const recorded = memoryAuditSink();
    const events = memoryOutboxSink();
    const claim = (await asPrincipal(manager, (context) =>
      runCommand(
        raiseWarrantyClaim,
        { context, audit: recorded, outbox: events },
        { ...onCustomer(), siteId: site },
      ),
    )) as Claim;
    expect(claim).toMatchObject({ entityId: 1, state: 'raised' });
    expect(claim.claimNo).toMatch(/\/WC\/\d{4}-\d{2}\/\d{4}$/);
    expect(recorded.records[0]).toMatchObject({
      command: 'inventory.warranty.raise',
      after: { claimNo: claim.claimNo, claimState: 'raised', accountId: account, siteId: site },
    });
    expect(events.records.map((e) => e.type)).toEqual(['inventory.warranty.raised']);
  });

  it('refuses a customer who does not deal with the company, and a site of another customer', async () => {
    const stranger = newId();
    await asMigrator(
      (m) => m`insert into accounts (id, type, name, created_by)
        values (${stranger}, 'farm', ${`Warranty stranger ${tag}`}, ${exec.id})`,
    );
    await expect(
      run(manager, raiseWarrantyClaim, { ...onCustomer(), accountId: stranger }),
    ).rejects.toMatchObject({ details: { reason: 'account_missing' } });
    await expect(
      run(manager, raiseWarrantyClaim, { ...onCustomer(), accountId: otherAccount, siteId: site }),
    ).rejects.toMatchObject({ details: { reason: 'site_missing' } });
  });

  it('raises a claim on a delivered serial, taking its customer and site, one open claim each', async () => {
    const failed = await serial('2099-01-31', { site });
    const claim = await run(manager, raiseWarrantyClaim, {
      entityId: 1,
      serialId: failed,
      reportedFault: 'Motor hums and does not start',
    });
    const [row] = await asMigrator(
      (m) => m<{ account: string; site: string; serial: string; item: string }[]>`
        select account_id as account, site_id as site, serial_id as serial, item_id as item
          from warranty_claims where id = ${claim.id}`,
    );
    expect(row).toEqual({ account, site, serial: failed, item });
    await expect(
      run(manager, raiseWarrantyClaim, {
        entityId: 1,
        serialId: failed,
        reportedFault: 'Reported again',
      }),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'warranty_claim_open' } });
    await expect(
      run(manager, raiseWarrantyClaim, {
        entityId: 1,
        accountId: otherAccount,
        serialId: failed,
        reportedFault: 'Wrong customer',
      }),
    ).rejects.toMatchObject({ details: { reason: 'warranty_serial_other_customer' } });
  });

  it('refuses a serial still in stock, and one of another company', async () => {
    const held = await serial(null, { state: 'scrapped', owner: null });
    await expect(
      run(manager, raiseWarrantyClaim, { entityId: 1, serialId: held, reportedFault: 'Broken' }),
    ).rejects.toMatchObject({ details: { reason: 'warranty_serial_not_delivered' } });
    await expect(
      run(exec, raiseWarrantyClaim, { entityId: 2, serialId: held, reportedFault: 'Broken' }),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'warranty_serial_unknown' } });
  });
});

describe('inventory.warranty.identify_serial', () => {
  async function raised(): Promise<Claim> {
    return run(manager, raiseWarrantyClaim, {
      entityId: 1,
      accountId: account,
      reportedFault: 'No water at the outlet',
    });
  }

  it('accepts a serial whose warranty ends today in India at 23:30, and refuses it at 00:30 the next day', async () => {
    const failed = await serial('2027-03-10');
    const late = await raised();
    // 23:30 IST on 10 March is 18:00 UTC: still the last day of the warranty.
    const ok = await run(
      manager,
      identifyWarrantySerial,
      { claimId: late.id, serialId: failed },
      new Date('2027-03-10T18:00:00Z'),
    );
    expect(ok.state).toBe('serial_identified');
    // 00:30 IST on 11 March is 19:00 UTC on 10 March: the UTC date would still pass.
    const other = await serial('2027-03-10');
    const after = await raised();
    await expect(
      run(
        manager,
        identifyWarrantySerial,
        { claimId: after.id, serialId: other },
        new Date('2027-03-10T19:00:00Z'),
      ),
    ).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'warranty_expired', warrantyUntil: '2027-03-10' },
    });
    const [row] = await asMigrator(
      (m) => m<{ state: string; serial: string | null }[]>`
        select state, serial_id as serial from warranty_claims where id = ${after.id}`,
    );
    expect(row).toEqual({ state: 'raised', serial: null });
  });

  it('refuses a serial without a warranty date, another customer’s, or one already claimed', async () => {
    const undated = await serial(null);
    const claim = await raised();
    await expect(
      run(manager, identifyWarrantySerial, { claimId: claim.id, serialId: undated }),
    ).rejects.toMatchObject({ details: { reason: 'warranty_expired', warrantyUntil: null } });
    const theirs = await serial('2099-01-31', { owner: otherAccount });
    await expect(
      run(manager, identifyWarrantySerial, { claimId: claim.id, serialId: theirs }),
    ).rejects.toMatchObject({ details: { reason: 'warranty_serial_other_customer' } });
    const claimed = await serial('2099-01-31');
    const first = await raised();
    await run(manager, identifyWarrantySerial, { claimId: first.id, serialId: claimed });
    await expect(
      run(manager, identifyWarrantySerial, { claimId: claim.id, serialId: claimed }),
    ).rejects.toMatchObject({ details: { reason: 'warranty_claim_open' } });
    // Identified once, the step is not repeated.
    await expect(
      run(manager, identifyWarrantySerial, { claimId: first.id, serialId: claimed }),
    ).rejects.toMatchObject({ details: { reason: 'warranty_claim_transition_not_allowed' } });
  });

  it('is refused for a claim of another company, and without the grant', async () => {
    const claim = await raised();
    const failed = await serial('2099-01-31');
    const elsewhere = await createTestPrincipal('inventory_manager', [2]);
    await expect(
      run(elsewhere, identifyWarrantySerial, { claimId: claim.id, serialId: failed }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      run(principalFor('general_manager', [1]), identifyWarrantySerial, {
        claimId: claim.id,
        serialId: failed,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('inventory.warranty.reject', () => {
  it('rejects a raised or identified claim with why, once', async () => {
    const claim = await run(manager, raiseWarrantyClaim, {
      entityId: 1,
      accountId: account,
      reportedFault: 'Cable cut by a plough',
    });
    await expect(
      run(principalFor('accounts', [1]), rejectWarrantyClaim, {
        claimId: claim.id,
        rejectedReason: 'Damage, not a fault',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const done = await run(manager, rejectWarrantyClaim, {
      claimId: claim.id,
      rejectedReason: 'Damage, not a fault',
    });
    expect(done.state).toBe('rejected');
    await expect(
      run(manager, rejectWarrantyClaim, { claimId: claim.id, rejectedReason: 'Again' }),
    ).rejects.toMatchObject({ details: { reason: 'warranty_claim_transition_not_allowed' } });
    // A manager of another company does not see the claim.
    const elsewhere = await createTestPrincipal('inventory_manager', [2]);
    await expect(
      run(elsewhere, rejectWarrantyClaim, { claimId: claim.id, rejectedReason: 'Not a fault' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    const events = await asOutboxPublisher(
      (m) => m<{ type: string }[]>`select type from outbox_events where aggregate_id = ${claim.id}
        order by created_at`,
    );
    expect(events.map((e) => e.type)).toEqual([
      'inventory.warranty.raised',
      'inventory.warranty.rejected',
    ]);
  });
});

describe('inventory.warranty.settle', () => {
  /** A claim awaiting its supplier, as the replacement and RMA steps leave it. */
  async function awaitingSupplier(entityId = 1): Promise<string> {
    const id = newId();
    const failed = await serial('2099-01-31', { entityId });
    const replacement = await serial('2099-01-31', { entityId });
    await asMigrator(
      (
        m,
      ) => m`insert into warranty_claims (id, entity_id, claim_no, account_id, item_id, serial_id, reported_fault,
                 state, replacement_serial_id, vendor_id, supplier_rma_ref, created_by)
        values (${id}, ${entityId}, ${`WT-${tag}-${id.slice(-6)}`}, ${account}, ${item}, ${failed},
                'No water flow', 'rma_raised', ${replacement}, ${vendor}, 'RMA-77', ${exec.id})`,
    );
    return id;
  }
  const credit = (claimId: string, creditAmount = '16250.50') => ({
    claimId,
    settlement: 'credit',
    creditAmount,
  });

  it('is refused without procurement.grn.write, and before the supplier RMA', async () => {
    const claimId = await awaitingSupplier();
    for (const roleKey of ['general_manager', 'accounts', 'store_manager'] as const) {
      await expect(
        run(principalFor(roleKey, [1]), settleWarrantyClaim, credit(claimId)),
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
    const early = await run(manager, raiseWarrantyClaim, {
      entityId: 1,
      accountId: account,
      reportedFault: 'Controller display blank',
    });
    await expect(run(manager, settleWarrantyClaim, credit(early.id))).rejects.toMatchObject({
      details: { reason: 'warranty_claim_transition_not_allowed' },
    });
    await expect(run(manager, settleWarrantyClaim, credit(claimId, '0.00'))).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('closes the claim with the credit kept only on its restricted costs', async () => {
    const claimId = await awaitingSupplier();
    const recorded = memoryAuditSink();
    const events = memoryOutboxSink();
    const out = await asPrincipal(manager, (context) =>
      runCommand(
        settleWarrantyClaim,
        { context, audit: recorded, outbox: events },
        credit(claimId),
      ),
    );
    expect(out).toMatchObject({ id: claimId, state: 'closed' });
    const visible = JSON.stringify({ out, audit: recorded.records, events: events.records });
    expect(visible).not.toMatch(/16250|creditAmount/);
    expect(recorded.records[0]).toMatchObject({
      after: { claimState: 'closed', settlement: 'credit' },
    });
    const [row] = await asMigrator(
      (m) => m<{ state: string; settlement: string; credit: string }[]>`
        select c.state, c.settlement, k.supplier_credit_amount::text as credit
          from warranty_claims c join warranty_claim_costs k on k.claim_id = c.id
         where c.id = ${claimId}`,
    );
    expect(row).toEqual({ state: 'closed', settlement: 'credit', credit: '16250.50' });
    await expect(run(manager, settleWarrantyClaim, credit(claimId))).rejects.toMatchObject({
      details: { reason: 'warranty_claim_transition_not_allowed' },
    });
  });

  it('is refused for a claim of another company', async () => {
    const claimId = await awaitingSupplier(2);
    await expect(run(manager, settleWarrantyClaim, credit(claimId))).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
