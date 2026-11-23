// U1 vendors and supplier quotes (docs/03-roadmap-appendix/phase3.md §6.3): the seven procurement
// commands and the three reads on real Postgres. Vendors are shared by the group and the suites
// never clean them, so every name and GSTIN this file writes carries the run's tag.
import { newId, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit, memoryAuditSink } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { executeCommand } from '../../src/command/execute';
import { runCommand } from '../../src/command/run-command';
import { setItemVendor, setVendorContacts } from '../../src/commands/procurement/vendor-links';
import { recordVendorQuote, withdrawVendorQuote } from '../../src/commands/procurement/quotes';
import { archiveVendor, createVendor, updateVendor } from '../../src/commands/procurement/vendors';
import { databaseOutboxSink as outbox, memoryOutboxSink } from '../../src/outbox/sink';
import {
  compareQuotes,
  getVendor,
  listVendors,
} from '../../src/queries/procurement/vendor-queries';

const tag = newId().slice(-6).toUpperCase();
let seq = 0;
const vendorName = (what: string) => `Procurement test ${tag} ${what} ${String((seq += 1))}`;
/** A GSTIN of state 08 whose PAN carries a fresh number, so each run's are its own. */
const gstin = () => {
  const n = String(1000 + ((seq += 1) % 9000)).padStart(4, '0');
  const letters = tag
    .replace(/[^A-Z]/g, 'Q')
    .padEnd(5, 'Q')
    .slice(0, 5);
  return { gstin: `08${letters}${n}F1Z5`, pan: `${letters}${n}F` };
};

let manager: Principal; // Inventory Manager acting in every company
let managerOne: Principal; // Inventory Manager of company 1 only
let executive: Principal;
let itemA: string;
let itemB: string;
let archivedItem: string;

const day = (offset: number) => {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000 + offset * 86400 * 1000);
  return d.toISOString().slice(0, 10);
};

beforeAll(async () => {
  manager = await createTestPrincipal('inventory_manager');
  managerOne = await createTestPrincipal('inventory_manager', [1]);
  executive = await createTestPrincipal('executive');
  itemA = newId();
  itemB = newId();
  archivedItem = newId();
  await asMigrator(
    (m) => m`insert into items (id, sku, name, category, hsn, unit, archived_at, is_active) values
      (${itemA}, ${`T-${tag}-CBL-A`}, ${`Procurement cable A ${tag}`}, 'cable', '8544', 'metre', null, true),
      (${itemB}, ${`T-${tag}-CBL-B`}, ${`Procurement cable B ${tag}`}, 'cable', '8544', 'metre', null, true),
      (${archivedItem}, ${`T-${tag}-CBL-X`}, ${`Procurement cable X ${tag}`}, 'cable', '8544', 'metre', now(), false)`,
  );
});
afterAll(closeDb);

function run<T = Record<string, unknown>>(
  principal: Principal,
  command: AnyCommand,
  input: unknown,
): Promise<T> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  ) as Promise<T>;
}

interface VendorOut {
  id: string;
  name: string;
  gstin: string | null;
  stateCode: string | null;
  pan: string | null;
  isActive: boolean;
}
interface QuoteOut {
  id: string;
  rate: string;
  status: string;
  entityId: number | null;
  withdrawnAt: string | null;
}

const NO_PO_WRITE = [
  'general_manager',
  'store_manager',
  'accounts',
  'tele_caller_cc',
  'tele_caller_lc',
  'project_manager',
  'agent:sizing',
  'agent:chief',
] as const;

describe('procurement.vendor.create / update / archive', () => {
  it('is denied to every role without procurement.po.write and to every agent', async () => {
    const v = await run<VendorOut>(manager, createVendor, { name: vendorName('denied') });
    for (const role of NO_PO_WRITE) {
      const who = principalFor(role, [1]);
      await expect(run(who, createVendor, { name: vendorName('x') })).rejects.toMatchObject({
        code: 'forbidden',
      });
      await expect(
        run(who, updateVendor, { vendorId: v.id, name: vendorName('x') }),
      ).rejects.toMatchObject({ code: 'forbidden' });
      await expect(run(who, archiveVendor, { vendorId: v.id })).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
  });

  it('adds a vendor for the whole group, audited for no one company, with the state and PAN from its GSTIN', async () => {
    const recorded = memoryAuditSink();
    const emitted = memoryOutboxSink();
    const ids = gstin();
    const v = await asPrincipal(managerOne, (context) =>
      runCommand(
        createVendor,
        { context, audit: recorded, outbox: emitted },
        {
          name: vendorName('new'),
          gstin: ids.gstin.toLowerCase(),
          address: { city: 'Jaipur', pin: '302001' },
          paymentTermsDays: 30,
          leadTimeDays: 7,
        },
      ),
    );
    expect(v).toMatchObject({
      gstin: ids.gstin,
      stateCode: '08',
      pan: ids.pan,
      address: { city: 'Jaipur', pin: '302001' },
      isActive: true,
    });
    expect(recorded.records).toEqual([
      expect.objectContaining({
        command: 'procurement.vendor.create',
        aggregateType: 'vendor',
        aggregateId: v.id,
        entityId: null,
      }),
    ]);
    expect(emitted.records).toEqual([
      expect.objectContaining({
        type: 'procurement.vendor.created',
        entityId: 1,
        aggregateId: v.id,
        payload: { v: 1 },
      }),
    ]);
    // Shared: a store manager acting for another company reads it.
    const seen = await asPrincipal(principalFor('store_manager', [4]), (context) =>
      listVendors(context, { q: v.name }),
    );
    expect(seen.items.map((r) => r.id)).toEqual([v.id]);
  });

  it('refuses a GSTIN already on another vendor, and a PAN or state that is not the GSTIN’s', async () => {
    const ids = gstin();
    await run(manager, createVendor, { name: vendorName('first'), gstin: ids.gstin });
    await expect(
      run(manager, createVendor, { name: vendorName('second'), gstin: ids.gstin }),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'vendor_gstin_taken' } });
    await expect(
      run(manager, createVendor, {
        name: vendorName('bad'),
        gstin: gstin().gstin,
        pan: 'ZZZZZ9999Z',
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      run(manager, createVendor, {
        name: vendorName('bad'),
        gstin: gstin().gstin,
        stateCode: '27',
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('edits and archives a vendor; an archived vendor stays readable and takes no change', async () => {
    const v = await run<VendorOut>(manager, createVendor, { name: vendorName('edit') });
    const edited = await run<VendorOut>(manager, updateVendor, {
      vendorId: v.id,
      name: `${v.name} edited`,
      leadTimeDays: 10,
      notes: 'Delivers on Mondays',
    });
    expect(edited).toMatchObject({ name: `${v.name} edited` });
    const archived = await run<VendorOut>(manager, archiveVendor, { vendorId: v.id });
    expect(archived.isActive).toBe(false);
    await expect(run(manager, archiveVendor, { vendorId: v.id })).rejects.toMatchObject({
      details: { reason: 'vendor_archived' },
    });
    await expect(
      run(manager, updateVendor, { vendorId: v.id, name: v.name }),
    ).rejects.toMatchObject({ details: { reason: 'vendor_archived' } });
    const sheet = await asPrincipal(principalFor('general_manager', [2]), (context) =>
      getVendor(context, { vendorId: v.id }),
    );
    expect(sheet.vendor.isActive).toBe(false);
  });

  it('answers vendor_missing for a vendor that does not exist', async () => {
    await expect(run(manager, archiveVendor, { vendorId: newId() })).rejects.toMatchObject({
      code: 'not_found',
      details: { reason: 'vendor_missing' },
    });
  });
});

describe('procurement.vendor.contact.set', () => {
  it('replaces the people as a set, in order, and audits names and roles but no number or email', async () => {
    const v = await run<VendorOut>(manager, createVendor, { name: vendorName('people') });
    await run(manager, setVendorContacts, {
      vendorId: v.id,
      contacts: [{ name: 'Ravi Sharma', phone: '98290 11223', email: 'Ravi@Example.com' }],
    });
    const recorded = memoryAuditSink();
    const out = await asPrincipal(manager, (context) =>
      runCommand(
        setVendorContacts,
        { context, audit: recorded, outbox: memoryOutboxSink() },
        {
          vendorId: v.id,
          contacts: [
            { name: 'Meena Joshi', role: 'Sales', phone: '+91 98290 44556' },
            { name: 'Ravi Sharma', email: 'ravi@example.com' },
          ],
        },
      ),
    );
    expect(out.contacts.map((c) => [c.position, c.name, c.phone, c.email])).toEqual([
      [1, 'Meena Joshi', '+919829044556', null],
      [2, 'Ravi Sharma', null, 'ravi@example.com'],
    ]);
    const [row] = recorded.records;
    expect(row?.before).toEqual({ vendorContacts: ['Ravi Sharma'] });
    expect(row?.after).toEqual({ vendorContacts: ['Meena Joshi (Sales)', 'Ravi Sharma'] });
    const cleared = await run<{ contacts: unknown[] }>(manager, setVendorContacts, {
      vendorId: v.id,
      contacts: [],
    });
    expect(cleared.contacts).toEqual([]);
  });

  it('is denied without procurement.po.write', async () => {
    const v = await run<VendorOut>(manager, createVendor, { name: vendorName('people denied') });
    await expect(
      run(principalFor('general_manager', [1]), setVendorContacts, {
        vendorId: v.id,
        contacts: [],
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('procurement.item_vendor.set', () => {
  it('links an item, keeps one preferred vendor per item, and removes a link', async () => {
    const first = await run<VendorOut>(manager, createVendor, { name: vendorName('supplier one') });
    const second = await run<VendorOut>(manager, createVendor, {
      name: vendorName('supplier two'),
    });
    const one = await run<{ link: { isPreferred: boolean; vendorItemCode: string | null } }>(
      manager,
      setItemVendor,
      { vendorId: first.id, itemId: itemA, vendorItemCode: 'C-4SQ', isPreferred: true },
    );
    expect(one.link).toMatchObject({ isPreferred: true, vendorItemCode: 'C-4SQ' });
    await run(manager, setItemVendor, { vendorId: second.id, itemId: itemA, isPreferred: true });
    const preferred = await asMigrator(
      (m) => m<{ vendor_id: string }[]>`
        select vendor_id from item_vendors where item_id = ${itemA} and is_preferred`,
    );
    expect(preferred.map((r) => r.vendor_id)).toEqual([second.id]);
    const removed = await run<{ link: unknown }>(manager, setItemVendor, {
      vendorId: first.id,
      itemId: itemA,
      supplies: false,
    });
    expect(removed.link).toBeNull();
    await expect(
      run(manager, setItemVendor, { vendorId: first.id, itemId: archivedItem }),
    ).rejects.toMatchObject({ details: { reason: 'catalogue_item_missing' } });
  });

  it('is denied without procurement.po.write', async () => {
    const v = await run<VendorOut>(manager, createVendor, { name: vendorName('link denied') });
    await expect(
      run(principalFor('store_manager', [1]), setItemVendor, { vendorId: v.id, itemId: itemA }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('procurement.quote.record / withdraw', () => {
  let vendor: VendorOut;
  const quote = (over: Record<string, unknown> = {}) => ({
    vendorId: vendor.id,
    itemId: itemA,
    entityId: 1,
    rate: '41.5',
    moq: '500',
    leadTimeDays: 5,
    validFrom: day(-1),
    validUntil: day(30),
    ...over,
  });

  beforeAll(async () => {
    vendor = await run<VendorOut>(manager, createVendor, { name: vendorName('quotes') });
  });

  it('is denied to a reader of rates who writes no purchase order, and to every other role without both', async () => {
    for (const role of [...NO_PO_WRITE]) {
      await expect(run(principalFor(role, [1]), recordVendorQuote, quote())).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
  });

  it('refuses a company outside the request, and a group quote unless the request covers every company', async () => {
    await expect(run(managerOne, recordVendorQuote, quote({ entityId: 2 }))).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      run(managerOne, recordVendorQuote, quote({ entityId: null })),
    ).rejects.toMatchObject({
      code: 'forbidden',
      details: { reason: 'vendor_quote_needs_all_companies' },
    });
  });

  it('records a quote: the rate in the quote only, never in the audit row or the event', async () => {
    const recorded = memoryAuditSink();
    const emitted = memoryOutboxSink();
    const out = await asPrincipal(managerOne, (context) =>
      runCommand(
        recordVendorQuote,
        { context, audit: recorded, outbox: emitted },
        quote({ rate: '1234.5678' }),
      ),
    );
    expect(out).toMatchObject({ rate: '1234.5678', moq: '500.000', status: 'live', entityId: 1 });
    const trail = JSON.stringify([recorded.records, emitted.records]);
    expect(trail).not.toContain('1234');
    expect(recorded.records).toEqual([
      expect.objectContaining({
        command: 'procurement.quote.record',
        aggregateType: 'vendor_quote',
        entityId: 1,
        after: {
          vendorId: vendor.id,
          itemId: itemA,
          quoteValidFrom: day(-1),
          quoteValidUntil: day(30),
        },
      }),
    ]);
    expect(emitted.records).toEqual([
      expect.objectContaining({
        type: 'procurement.quote.recorded',
        entityId: 1,
        payload: { vendorId: vendor.id, itemId: itemA, forGroup: false, v: 1 },
      }),
    ]);
  });

  it('a refused or failed record keeps no rate in its audit row', async () => {
    const accounts = await createTestPrincipal('accounts', [1]);
    const requestId = newId();
    await expect(
      executeCommand(accounts, { requestId }, recordVendorQuote, quote({ rate: '9876.5432' })),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const failedId = newId();
    await expect(
      executeCommand(
        managerOne,
        { requestId: failedId },
        recordVendorQuote,
        quote({ rate: '9876.5432', validFrom: day(-30), validUntil: day(-1) }),
      ),
    ).rejects.toMatchObject({ details: { reason: 'vendor_quote_ended' } });
    const rows = await asMigrator(
      (m) => m<{ outcome: string; input: unknown }[]>`
        select outcome, input_json as input from audit_logs
         where request_id in (${requestId}, ${failedId}) order by outcome`,
    );
    expect(rows.map((r) => r.outcome)).toEqual(['denied', 'failed']);
    expect(JSON.stringify(rows)).not.toContain('9876');
  });

  it('records a group quote acting for every company', async () => {
    for (const who of [manager, executive]) {
      const out = await run<QuoteOut>(who, recordVendorQuote, quote({ entityId: null }));
      expect(out.entityId).toBeNull();
    }
  });

  it('refuses a quote that has already ended, an archived item and a missing quote document', async () => {
    await expect(
      run(managerOne, recordVendorQuote, quote({ validFrom: day(-30), validUntil: day(-1) })),
    ).rejects.toMatchObject({ details: { reason: 'vendor_quote_ended' } });
    await expect(
      run(managerOne, recordVendorQuote, quote({ itemId: archivedItem })),
    ).rejects.toMatchObject({ details: { reason: 'catalogue_item_missing' } });
    await expect(
      run(managerOne, recordVendorQuote, quote({ fileId: newId() })),
    ).rejects.toMatchObject({ details: { reason: 'vendor_quote_file_missing' } });
  });

  it('takes a ready quote document of the company, and refuses another purpose or company', async () => {
    const file = (purpose: string, entityId: number) => {
      const id = newId();
      return asMigrator(
        (
          m,
        ) => m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
          values (${id}, ${entityId}, ${purpose}, 'test', ${`test/${id}`}, 'quote.pdf', 'application/pdf', 1, ${'a'.repeat(64)}, 'ready', ${managerOne.id})`,
      ).then(() => id);
    };
    const good = await file('vendor_quote', 1);
    const out = await run<QuoteOut & { fileId: string }>(
      managerOne,
      recordVendorQuote,
      quote({ fileId: good }),
    );
    expect(out.fileId).toBe(good);
    const otherCompany = await file('vendor_quote', 2);
    await expect(
      run(manager, recordVendorQuote, quote({ fileId: otherCompany })),
    ).rejects.toMatchObject({ details: { reason: 'vendor_quote_file_missing' } });
    const import_ = await file('import', 1);
    await expect(
      run(managerOne, recordVendorQuote, quote({ fileId: import_ })),
    ).rejects.toMatchObject({ details: { reason: 'vendor_quote_file_missing' } });
  });

  it('withdraws a quote once; another company’s holder cannot reach it', async () => {
    const q = await run<QuoteOut>(managerOne, recordVendorQuote, quote());
    const other = await createTestPrincipal('inventory_manager', [2]);
    await expect(run(other, withdrawVendorQuote, { quoteId: q.id })).rejects.toMatchObject({
      details: { reason: 'vendor_quote_missing' },
    });
    await expect(
      run(principalFor('accounts', [1]), withdrawVendorQuote, { quoteId: q.id }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const done = await run<QuoteOut>(managerOne, withdrawVendorQuote, { quoteId: q.id });
    expect(done).toMatchObject({ status: 'withdrawn' });
    expect(done.withdrawnAt).not.toBeNull();
    await expect(run(managerOne, withdrawVendorQuote, { quoteId: q.id })).rejects.toMatchObject({
      details: { reason: 'vendor_quote_withdrawn' },
    });
  });

  it('archiving a vendor withdraws none of its quotes', async () => {
    const v = await run<VendorOut>(manager, createVendor, { name: vendorName('archived quotes') });
    const q = await run<QuoteOut>(managerOne, recordVendorQuote, quote({ vendorId: v.id }));
    await run(manager, archiveVendor, { vendorId: v.id });
    const sheet = await asPrincipal(managerOne, (context) =>
      getVendor(context, { vendorId: v.id }),
    );
    expect('quotes' in sheet && sheet.quotes.map((x) => [x.id, x.status])).toEqual([
      [q.id, 'live'],
    ]);
    await expect(
      run(managerOne, recordVendorQuote, quote({ vendorId: v.id })),
    ).rejects.toMatchObject({ details: { reason: 'vendor_archived' } });
  });
});

describe('the vendor sheet and the comparison', () => {
  let cheap: VendorOut;
  let dear: VendorOut;
  let lapsed: VendorOut;

  beforeAll(async () => {
    cheap = await run<VendorOut>(manager, createVendor, { name: vendorName('cheap') });
    dear = await run<VendorOut>(manager, createVendor, { name: vendorName('dear') });
    lapsed = await run<VendorOut>(manager, createVendor, { name: vendorName('lapsed') });
    await run(manager, setItemVendor, { vendorId: cheap.id, itemId: itemB });
    await run(managerOne, recordVendorQuote, {
      vendorId: cheap.id,
      itemId: itemB,
      entityId: 1,
      rate: '20',
      validFrom: day(-1),
      validUntil: day(10),
    });
    await run(manager, recordVendorQuote, {
      vendorId: dear.id,
      itemId: itemB,
      entityId: null,
      rate: '25',
      validFrom: day(-1),
      validUntil: day(10),
    });
    // A company 2 quote, cheaper than all, never seen when comparing for company 1.
    await run(manager, recordVendorQuote, {
      vendorId: dear.id,
      itemId: itemB,
      entityId: 2,
      rate: '5',
      validFrom: day(-1),
      validUntil: day(10),
    });
    // The cheapest of all, but ended: recorded live, then its end moved into the past as time
    // would move it.
    const old = await run<QuoteOut>(managerOne, recordVendorQuote, {
      vendorId: lapsed.id,
      itemId: itemB,
      entityId: 1,
      rate: '10',
      validFrom: day(-1),
      validUntil: day(0),
    });
    await asMigrator(
      (m) =>
        m`update vendor_quotes set valid_from = ${day(-20)}, valid_until = ${day(-2)} where id = ${old.id}`,
    );
  });

  it('a General Manager and a Store Manager read the sheet without any quote or rate', async () => {
    for (const role of ['general_manager', 'store_manager'] as const) {
      const sheet = await asPrincipal(principalFor(role, [1]), (context) =>
        getVendor(context, { vendorId: cheap.id }),
      );
      expect(Object.keys(sheet).sort()).toEqual(['contacts', 'items', 'vendor']);
      expect(JSON.stringify(sheet)).not.toContain('20.0000');
      expect(sheet.items.map((i) => i.itemId)).toEqual([itemB]);
    }
  });

  it('a holder of procurement.rate.read reads the quotes of their company and the group', async () => {
    const sheet = await asPrincipal(principalFor('accounts', [2]), (context) =>
      getVendor(context, { vendorId: dear.id }),
    );
    expect('quotes' in sheet && sheet.quotes.map((q) => [q.entityId, q.rate]).sort()).toEqual(
      [
        [2, '5.0000'],
        [null, '25.0000'],
      ].sort(),
    );
    const inOne = await asPrincipal(principalFor('accounts', [1]), (context) =>
      getVendor(context, { vendorId: dear.id }),
    );
    expect('quotes' in inOne && inOne.quotes.map((q) => q.entityId)).toEqual([null]);
  });

  /** The comparison's row for an item, paging through the items as the screen does. */
  async function compareRow(itemId: string, entityId = 1) {
    let cursor: string | undefined;
    for (let page = 0; page < 50; page += 1) {
      const out = await asPrincipal(principalFor('inventory_manager', [entityId]), (context) =>
        compareQuotes(context, { entityId, category: 'cable', ...(cursor ? { cursor } : {}) }),
      );
      const row = out.rows.find((r) => r.itemId === itemId);
      if (row !== undefined || out.nextCursor === null) return { out, row };
      cursor = out.nextCursor;
    }
    throw new Error('the item was not found in 50 pages');
  }

  it('compares for one company: the lowest live rate marked, the expired one shown but never marked', async () => {
    const { out, row } = await compareRow(itemB);
    const cells = Object.fromEntries((row?.cells ?? []).map((c) => [c.vendorId, c]));
    expect(cells[cheap.id]).toMatchObject({ rate: '20.0000', status: 'live', isLowest: true });
    expect(cells[dear.id]).toMatchObject({ rate: '25.0000', status: 'live', isLowest: false });
    expect(cells[lapsed.id]).toMatchObject({ rate: '10.0000', status: 'expired', isLowest: false });
    expect(row?.unit).toBe('metre');
    expect(JSON.stringify(out)).not.toContain('"5.0000"');
  });

  it('leaves out an archived vendor\u2019s quotes and a quote that ended over a year ago (review L1, M6)', async () => {
    const gone = await run<VendorOut>(manager, createVendor, { name: vendorName('gone') });
    await run(managerOne, recordVendorQuote, {
      vendorId: gone.id,
      itemId: itemB,
      entityId: 1,
      rate: '1',
      validFrom: day(-1),
      validUntil: day(10),
    });
    await run(manager, archiveVendor, { vendorId: gone.id });
    const old = await run<VendorOut>(manager, createVendor, { name: vendorName('old') });
    const ancient = await run<QuoteOut>(managerOne, recordVendorQuote, {
      vendorId: old.id,
      itemId: itemB,
      entityId: 1,
      rate: '2',
      validFrom: day(-1),
      validUntil: day(0),
    });
    await asMigrator(
      (m) => m`update vendor_quotes set valid_from = ${day(-500)}, valid_until = ${day(-366)}
                 where id = ${ancient.id}`,
    );
    const { row } = await compareRow(itemB);
    const vendorsShown = (row?.cells ?? []).map((c) => c.vendorId);
    expect(vendorsShown).toContain(cheap.id);
    expect(vendorsShown).not.toContain(gone.id);
    expect(vendorsShown).not.toContain(old.id);
  });

  it('pages by item, a page at a time by name', async () => {
    const reader = principalFor('inventory_manager', [1]);
    const first = await asPrincipal(reader, (context) =>
      compareQuotes(context, { entityId: 1, category: 'cable', limit: 1 }),
    );
    expect(first.rows).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await asPrincipal(reader, (context) =>
      compareQuotes(context, {
        entityId: 1,
        category: 'cable',
        limit: 1,
        cursor: first.nextCursor ?? undefined,
      }),
    );
    expect(second.rows).toHaveLength(1);
    const names = [first.rows[0]?.itemName ?? '', second.rows[0]?.itemName ?? ''];
    expect(names[0] <= names[1]).toBe(true);
    expect(second.rows[0]?.itemId).not.toBe(first.rows[0]?.itemId);
  });

  it('refuses the comparison and the vendor list to whoever may not read them', async () => {
    await expect(
      asPrincipal(principalFor('general_manager', [1]), (context) =>
        compareQuotes(context, { entityId: 1 }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      asPrincipal(principalFor('inventory_manager', [1]), (context) =>
        compareQuotes(context, { entityId: 2 }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      asPrincipal(principalFor('tele_caller_cc', [1]), (context) => listVendors(context, {})),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('pages the vendor list by name', async () => {
    const reader = principalFor('store_manager', [1]);
    const q = `Procurement test ${tag}`;
    const first = await asPrincipal(reader, (context) => listVendors(context, { q, limit: 2 }));
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await asPrincipal(reader, (context) =>
      listVendors(context, { q, limit: 2, cursor: first.nextCursor ?? undefined }),
    );
    const names = [...first.items, ...second.items].map((r) => r.name);
    expect(names).toEqual([...names].sort());
    expect(new Set(names).size).toBe(names.length);
  });
});
