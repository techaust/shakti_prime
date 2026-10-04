import { AGENT_ROLE_KEYS, newId, type Principal } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
  withoutContext,
} from '../../src/testing/index';

// The PIN code master and what reads it (docs/design/phase1.md §6.3, migration 0091): shared by
// every company, read by every request, written only by an Executive acting for every company;
// a site's PIN filled from it; and an import file that must arrive by the pre-signed upload.
// Every PIN here starts 9999, outside the India Post directory, and names a fixture office.

afterAll(closeDb);

let executive: Principal;
let narrowExecutive: Principal;
let gm: Principal;

beforeAll(async () => {
  executive = await createTestPrincipal('executive');
  narrowExecutive = { ...executive, entityIds: [1] };
  gm = await createTestPrincipal('general_manager', [1, 2, 3, 4]);
});

/** The fixture PINs this file has drawn, so no two of its tests share one. */
const drawn = new Set<string>();

/**
 * A fixture PIN with no office left by an earlier run (the suites never clean the master), so a
 * test counts only its own offices: one of 999910 to 999949, never one this file drew before.
 * 999901 is the CRM fixture's; the domain suite draws from 999950 up.
 */
async function pin(): Promise<string> {
  const free = Array.from({ length: 40 }, (_, i) => `9999${String(10 + i)}`).filter(
    (code) => !drawn.has(code),
  );
  const code = free[Math.floor(Math.random() * free.length)];
  if (code === undefined) throw new Error('the fixture PINs of this file are used up');
  drawn.add(code);
  await asMigrator((m) => m`delete from pin_codes where pin = ${code}`);
  return code;
}

const rlsError = (e: unknown) =>
  e instanceof Error && e.cause instanceof Error && e.cause.message.includes('row-level security');
const deniedError = (e: unknown) =>
  e instanceof Error && e.cause instanceof Error && e.cause.message.includes('permission denied');

function addOffice(principal: Principal, office: { pin: string; name: string; district: string }) {
  return asPrincipal(principal, ({ tx }) =>
    tx.execute(sql`
      insert into pin_codes (id, pin, office_name, district, created_by)
      values (${newId()}, ${office.pin}, ${office.name}, ${office.district}, ${principal.id})`),
  );
}

async function officeCount(code: string): Promise<number> {
  const [row] = await asMigrator(
    (m) => m<{ n: number }[]>`select count(*)::int as n from pin_codes where pin = ${code}`,
  );
  return row?.n ?? -1;
}

describe('pin_codes: who writes the PIN code master', () => {
  it('an Executive acting for every company adds, corrects and removes an office', async () => {
    const code = await pin();
    await addOffice(executive, { pin: code, name: `fixture office ${code}`, district: 'Fixture' });
    expect(await officeCount(code)).toBe(1);
    const corrected = await asPrincipal(
      executive,
      async ({ tx }) =>
        (await tx.execute(sql`
        update pin_codes set district = 'Fixture corrected', taluk = 'Fixture taluk'
         where pin = ${code} returning id`)) as unknown as { id: string }[],
    );
    expect(corrected).toHaveLength(1);
    const removed = await asPrincipal(
      executive,
      async ({ tx }) =>
        (await tx.execute(
          sql`delete from pin_codes where pin = ${code} returning id`,
        )) as unknown as { id: string }[],
    );
    expect(removed).toHaveLength(1);
    expect(await officeCount(code)).toBe(0);
  });

  it('an Executive narrowed to one company, a GM and every agent are refused', async () => {
    const code = await pin();
    for (const principal of [narrowExecutive, gm, ...AGENT_ROLE_KEYS.map((k) => principalFor(k))]) {
      await expect(
        addOffice(principal, { pin: code, name: 'fixture office', district: 'Fixture' }),
      ).rejects.toSatisfy(rlsError);
    }
    expect(await officeCount(code)).toBe(0);
  });

  it('nobody changes or removes an office outside a request for every company', async () => {
    const code = await pin();
    await addOffice(executive, { pin: code, name: `fixture office ${code}`, district: 'Fixture' });
    for (const principal of [narrowExecutive, gm]) {
      const changed = await asPrincipal(principal, async ({ tx }) => [
        ...((await tx.execute(
          sql`update pin_codes set district = 'Changed' where pin = ${code} returning id`,
        )) as unknown as unknown[]),
        ...((await tx.execute(
          sql`delete from pin_codes where pin = ${code} returning id`,
        )) as unknown as unknown[]),
      ]);
      expect(changed).toEqual([]);
    }
    expect(await officeCount(code)).toBe(1);
  });

  it('one office per PIN and name, whatever the case of the name', async () => {
    const code = await pin();
    await addOffice(executive, { pin: code, name: 'Fixture Office', district: 'Fixture' });
    await expect(
      addOffice(executive, { pin: code, name: 'FIXTURE OFFICE', district: 'Fixture' }),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Error &&
        e.cause instanceof Error &&
        e.cause.message.includes('pin_codes_pin_office_unique'),
    );
    expect(await officeCount(code)).toBe(1);
  });

  it("an office's PIN and name are never changed, only what the directory says of it", async () => {
    const code = await pin();
    await addOffice(executive, { pin: code, name: `fixture office ${code}`, district: 'Fixture' });
    await expect(
      asPrincipal(executive, ({ tx }) =>
        tx.execute(sql`update pin_codes set office_name = 'Renamed' where pin = ${code}`),
      ),
    ).rejects.toSatisfy(deniedError);
  });

  it('every signed-in request reads it, and nothing is read without a context', async () => {
    const code = await pin();
    await addOffice(executive, { pin: code, name: `fixture office ${code}`, district: 'Fixture' });
    for (const principal of [principalFor('tele_caller_cc', [3]), principalFor('agent:triage')]) {
      const seen = await asPrincipal(
        principal,
        async ({ tx }) =>
          (await tx.execute(sql`select pin from pin_codes where pin = ${code}`)) as unknown as {
            pin: string;
          }[],
      );
      expect(seen).toEqual([{ pin: code }]);
    }
    expect(
      await withoutContext<{ pin: string }>(sql`select pin from pin_codes where pin = ${code}`),
    ).toEqual([]);
  });
});

describe('customer_sites_pin_fill: a site takes what the PIN code master knows of its PIN', () => {
  async function newSite(principal: Principal, sitePin: string | null, tehsil: string | null) {
    const accountId = newId();
    const siteId = newId();
    await asMigrator((m) =>
      m.begin(async (tx) => {
        await tx`insert into accounts (id, type, name, created_by)
          values (${accountId}, 'farm', 'fixture account', ${principal.id})`;
        await tx`insert into account_entities (id, account_id, entity_id, owner_id, created_by)
          values (${newId()}, ${accountId}, 1, ${principal.id}, ${principal.id})`;
      }),
    );
    // The site itself is written as a person writes it, under the policies.
    await asPrincipal(principal, ({ tx }) =>
      tx.execute(sql`
        insert into customer_sites (id, account_id, type, village, pin, tehsil, created_by)
        values (${siteId}, ${accountId}, 'borewell', 'fixture village', ${sitePin}, ${tehsil},
                ${principal.id})`),
    );
    return siteId;
  }

  async function site(siteId: string) {
    const [row] = await asMigrator(
      (m) =>
        m<
          {
            tehsil: string | null;
            district: string | null;
            state_code: string | null;
            pin_needs_review: boolean;
          }[]
        >`select tehsil, district, state_code, pin_needs_review from customer_sites where id = ${siteId}`,
    );
    return row;
  }

  it('fills the tehsil, district and state every office agrees on, and keeps what was typed', async () => {
    const code = await pin();
    for (const name of ['fixture office one', 'fixture office two']) {
      await asPrincipal(executive, ({ tx }) =>
        tx.execute(sql`
          insert into pin_codes (id, pin, office_name, taluk, district, state_code, created_by)
          values (${newId()}, ${code}, ${name}, 'Fixture taluk', 'Fixture district', '08',
                  ${executive.id})`),
      );
    }
    expect(await site(await newSite(gm, code, null))).toEqual({
      tehsil: 'Fixture taluk',
      district: 'Fixture district',
      state_code: '08',
      pin_needs_review: false,
    });
    expect(await site(await newSite(gm, code, 'Typed tehsil'))).toMatchObject({
      tehsil: 'Typed tehsil',
      district: 'Fixture district',
    });
  });

  it('leaves out what the offices of a PIN disagree on', async () => {
    const code = await pin();
    for (const [name, taluk] of [
      ['fixture office one', 'Fixture taluk one'],
      ['fixture office two', 'Fixture taluk two'],
    ] as const) {
      await asPrincipal(executive, ({ tx }) =>
        tx.execute(sql`
          insert into pin_codes (id, pin, office_name, taluk, district, created_by)
          values (${newId()}, ${code}, ${name}, ${taluk}, 'Fixture district', ${executive.id})`),
      );
    }
    expect(await site(await newSite(gm, code, null))).toEqual({
      tehsil: null,
      district: 'Fixture district',
      state_code: null,
      pin_needs_review: false,
    });
  });

  it('saves a site whose PIN is not in the master and flags it for review', async () => {
    const unknown = await pin();
    const siteId = await newSite(gm, unknown, null);
    expect(await site(siteId)).toEqual({
      tehsil: null,
      district: null,
      state_code: null,
      pin_needs_review: true,
    });

    // The PIN corrected to one the master knows: the flag goes and the place is filled.
    const known = await pin();
    await addOffice(executive, { pin: known, name: 'fixture office', district: 'Fixture known' });
    await asPrincipal(gm, ({ tx }) =>
      tx.execute(sql`update customer_sites set pin = ${known} where id = ${siteId}`),
    );
    expect(await site(siteId)).toMatchObject({
      district: 'Fixture known',
      pin_needs_review: false,
    });

    // No PIN at all needs no check.
    expect(await site(await newSite(gm, null, null))).toMatchObject({ pin_needs_review: false });
  });

  it('checks a flagged site again when it is written with its PIN unchanged', async () => {
    const code = await pin();
    const siteId = await newSite(gm, code, 'Typed tehsil');
    expect(await site(siteId)).toMatchObject({ pin_needs_review: true });
    await addOffice(executive, { pin: code, name: 'fixture office', district: 'Fixture later' });
    // Still flagged: nothing wrote the site yet.
    expect(await site(siteId)).toMatchObject({ pin_needs_review: true });
    await asPrincipal(gm, ({ tx }) =>
      tx.execute(
        sql`update customer_sites set village = 'fixture village two' where id = ${siteId}`,
      ),
    );
    // The flag goes and only what the site left empty is filled.
    expect(await site(siteId)).toEqual({
      tehsil: 'Typed tehsil',
      district: 'Fixture later',
      state_code: null,
      pin_needs_review: false,
    });
  });
});

describe('app.recheck_site_pins: sites checked again after a PIN code import', () => {
  async function flaggedSite(code: string): Promise<string> {
    const accountId = newId();
    const siteId = newId();
    await asMigrator((m) =>
      m.begin(async (tx) => {
        await tx`insert into accounts (id, type, name, created_by)
          values (${accountId}, 'farm', 'fixture account', ${gm.id})`;
        await tx`insert into account_entities (id, account_id, entity_id, owner_id, created_by)
          values (${newId()}, ${accountId}, 4, ${gm.id}, ${gm.id})`;
        await tx`insert into customer_sites (id, account_id, type, village, pin, created_by)
          values (${siteId}, ${accountId}, 'borewell', 'fixture village', ${code}, ${gm.id})`;
      }),
    );
    return siteId;
  }

  const recheck = (principal: Principal, code: string) =>
    asPrincipal(
      principal,
      async ({ tx }) =>
        (
          (await tx.execute(
            sql`select app.recheck_site_pins(array[${code}]::text[]) as n`,
          )) as unknown as { n: number }[]
        )[0]?.n,
    );

  async function flagOf(siteId: string) {
    const [row] = await asMigrator(
      (m) => m<{ district: string | null; pin_needs_review: boolean }[]>`
        select district, pin_needs_review from customer_sites where id = ${siteId}`,
    );
    return row;
  }

  it('is refused to anyone but an Executive acting for every company', async () => {
    const code = await pin();
    for (const principal of [narrowExecutive, gm, principalFor('agent:triage')]) {
      await expect(recheck(principal, code)).rejects.toSatisfy(
        (e: unknown) =>
          e instanceof Error &&
          e.cause instanceof Error &&
          e.cause.message.includes('imports.write:all'),
      );
    }
  });

  it("clears the flag of every company's sites once the PIN is known, and sets it again once not", async () => {
    const code = await pin();
    // A site of a company the Executive's own relationships do not reach.
    const siteId = await flaggedSite(code);
    expect(await flagOf(siteId)).toEqual({ district: null, pin_needs_review: true });
    await addOffice(executive, { pin: code, name: 'fixture office', district: 'Fixture checked' });
    expect(await recheck(executive, code)).toBe(1);
    expect(await flagOf(siteId)).toEqual({ district: 'Fixture checked', pin_needs_review: false });
    // Asked again, nothing is left to change.
    expect(await recheck(executive, code)).toBe(0);
    await asPrincipal(executive, ({ tx }) =>
      tx.execute(sql`delete from pin_codes where pin = ${code}`),
    );
    expect(await recheck(executive, code)).toBe(1);
    expect(await flagOf(siteId)).toEqual({ district: 'Fixture checked', pin_needs_review: true });
  });
});

describe('files: an import file arrives by the pre-signed upload', () => {
  it('a person records an import upload only as pending, never as ready', async () => {
    const insert = (status: string) =>
      asPrincipal(gm, ({ tx }) =>
        tx.execute(sql`
          insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256,
                             status, created_by)
          values (${newId()}, 1, 'import', 'local', ${`1/import/${newId()}.csv`}, 'fixture.csv',
                  'text/csv', 10, ${'a'.repeat(64)}, ${status}, ${gm.id})`),
      );
    await expect(insert('ready')).rejects.toSatisfy(rlsError);
    await expect(insert('pending')).resolves.toBeDefined();
  });
});

describe('app.stale_upload_entities: the companies the sweep visits', () => {
  it('answers only the worker principal, and names the companies of stale pending uploads', async () => {
    const fileId = newId();
    await asMigrator(
      (m) => m`
        insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256,
                           status, created_by, created_at)
        values (${fileId}, 3, 'import', 'local', ${`3/import/${fileId}.csv`}, 'fixture.csv',
                'text/csv', 10, ${'b'.repeat(64)}, 'pending', ${gm.id}, now() - interval '2 days')`,
    );
    const worker = principalFor('system:workers', []);
    const companies = await asPrincipal(worker, async ({ tx }) =>
      (
        (await tx.execute(sql`select e from app.stale_upload_entities(1440) as e`)) as unknown as {
          e: number;
        }[]
      ).map((r) => r.e),
    );
    expect(companies).toContain(3);
    for (const principal of [executive, gm, principalFor('agent:triage')]) {
      await expect(
        asPrincipal(principal, ({ tx }) =>
          tx.execute(sql`select * from app.stale_upload_entities(1440)`),
        ),
      ).rejects.toSatisfy(
        (e: unknown) =>
          e instanceof Error &&
          e.cause instanceof Error &&
          e.cause.message.includes('files.process:all'),
      );
    }
    await asMigrator((m) => m`delete from files where id = ${fileId}`);
  });
});
