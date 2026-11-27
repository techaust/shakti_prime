import {
  AGENT_FORBIDDEN_PERMISSIONS,
  hasGrant,
  newId,
  STAFF_ROLE_KEYS,
  type Principal,
  type StaffRoleKey,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AGENT_MATRIX,
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
  withoutContext,
} from '../../src/testing/index';

/*
 * J3 customer documents (docs/03-roadmap-appendix/phase4.md §6.3, SECURITY §5, §11 items 7 and 8):
 * documents and their files by documents.read per scope, a sensitive one only with
 * documents.sensitive.read, an identity document's last four digits likewise and only while its
 * document stays filed, uploads only for a customer the uploader may file for, and the
 * completeness definer. Every number here is made up.
 */

afterAll(closeDb);

const SHA = 'd'.repeat(64);

/** The database's own message, whether the driver error is thrown bare or wrapped by Drizzle. */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    return cause instanceof Error ? cause.message : String(cause);
  }
  throw new Error('expected the statement to fail');
}

/** A customer of `entityIds`, owned in each by `ownerId`. */
async function customer(ownerId: string, entityIds: readonly number[] = [1]): Promise<string> {
  const account = newId();
  await asMigrator(async (m) => {
    await m`insert into accounts (id, type, name, created_by)
      values (${account}, 'household', 'documents test customer', ${ownerId})`;
    for (const e of entityIds) {
      await m`insert into account_entities (id, account_id, entity_id, owner_id, created_by)
        values (${newId()}, ${account}, ${e}, ${ownerId}, ${ownerId})`;
    }
  });
  return account;
}

/** A checked customer document of `account` in company `entityId`, uploaded by `uploadedBy`. */
async function documentFile(
  entityId: number,
  account: string,
  uploadedBy: string,
): Promise<string> {
  const id = newId();
  await asMigrator(
    (
      m,
    ) => m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256,
                                status, scan_result, account_id, created_by)
      values (${id}, ${entityId}, 'customer_document', 'test', ${`files/${id}.jpg`}, 'photo.jpg',
              'image/jpeg', 10, ${SHA}, 'ready',
              ${JSON.stringify({ sanitising: 'masked', verdict: 'not_scanned' })}::jsonb, ${account}, ${uploadedBy})`,
  );
  return id;
}

/** A filed document, written as the table owner. */
async function fileDirectly(
  entityId: number,
  account: string,
  file: string,
  kind: 'electricity_bill' | 'identity_proof',
  filedBy: string,
): Promise<string> {
  const id = newId();
  const sensitive = kind === 'identity_proof';
  await asMigrator(async (m) => {
    await m`insert into documents (id, entity_id, account_id, requirement_key, kind, file_id,
                                   sensitive, filed_by_kind, filed_by)
      values (${id}, ${entityId}, ${account}, ${kind}, ${kind}, ${file}, ${sensitive}, 'person',
              ${filedBy})`;
    if (sensitive) {
      await m`insert into identity_documents (id, entity_id, account_id, document_id, kind, last4,
                                              masked_file_id, created_by)
        values (${newId()}, ${entityId}, ${account}, ${id}, 'aadhaar', '0123', ${file}, ${filedBy})`;
    }
  });
  return id;
}

async function ids(
  principal: Principal,
  table: string,
  wanted: readonly string[],
): Promise<string[]> {
  const rows = await asPrincipal(
    principal,
    ({ tx }) =>
      tx.execute(
        sql`select id::text from ${sql.identifier(table)}
             where id = any(${`{${wanted.join(',')}}`}::uuid[])`,
      ) as unknown as Promise<{ id: string }[]>,
  );
  return rows.map((r) => r.id).sort();
}

async function lastFours(principal: Principal, documentId: string): Promise<string[]> {
  const rows = await asPrincipal(
    principal,
    ({ tx }) =>
      tx.execute(
        sql`select last4 from identity_documents where document_id = ${documentId}`,
      ) as unknown as Promise<{ last4: string }[]>,
  );
  return rows.map((r) => r.last4);
}

describe('documents and their files by documents.read, a sensitive one only with documents.sensitive.read', () => {
  let owner: Principal;
  let account: string;
  let billFile: string;
  let idFile: string;
  let bill: string;
  let idDoc: string;

  beforeAll(async () => {
    owner = await createTestPrincipal('field_engineer', [1]);
    account = await customer(owner.id);
    billFile = await documentFile(1, account, owner.id);
    idFile = await documentFile(1, account, owner.id);
    bill = await fileDirectly(1, account, billFile, 'electricity_bill', owner.id);
    idDoc = await fileDirectly(1, account, idFile, 'identity_proof', owner.id);
  });

  it.each(STAFF_ROLE_KEYS)(
    '%s acting in company 1, not the customer’s owner, reads what its grants say',
    async (role: StaffRoleKey) => {
      const principal = principalFor(role, [1]);
      const reads = hasGrant(principal.permissions, 'documents.read', 'entity');
      const sensitive =
        reads && hasGrant(principal.permissions, 'documents.sensitive.read', 'entity');
      const documents = [...(reads ? [bill] : []), ...(sensitive ? [idDoc] : [])].sort();
      const files = [...(reads ? [billFile] : []), ...(sensitive ? [idFile] : [])].sort();
      expect(await ids(principal, 'documents', [bill, idDoc])).toEqual(documents);
      expect(await ids(principal, 'files', [billFile, idFile])).toEqual(files);
      expect(await lastFours(principal, idDoc)).toEqual(sensitive ? ['0123'] : []);
    },
  );

  it.each(['field_engineer', 'tele_caller_lc', 'store_manager'] as const)(
    'a %s who owns the customer reads the bill, never the identity paper or its last four digits',
    async (role) => {
      const principal = principalFor(role, [1], { id: owner.id });
      expect(await ids(principal, 'documents', [bill, idDoc])).toEqual([bill]);
      // Their own upload, once filed as sensitive, is read only through the document's rule.
      expect(await ids(principal, 'files', [billFile, idFile])).toEqual([billFile]);
      expect(await lastFours(principal, idDoc)).toEqual([]);
    },
  );

  it('shows none of it acting in another company, or without a context', async () => {
    const executive = principalFor('executive', [2]);
    expect(await ids(executive, 'documents', [bill, idDoc])).toEqual([]);
    expect(await ids(executive, 'files', [billFile, idFile])).toEqual([]);
    for (const table of ['documents', 'identity_documents', 'document_requirements']) {
      const [row] = await withoutContext<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table)}`,
      );
      expect({ table, n: row?.n }).toEqual({ table, n: 0 });
    }
  });

  it('no agent principal holds documents.sensitive.read, so none reads a sensitive row', async () => {
    expect(AGENT_FORBIDDEN_PERMISSIONS).toContain('documents.sensitive.read');
    for (const role of Object.keys(AGENT_MATRIX) as (keyof typeof AGENT_MATRIX)[]) {
      const agent = principalFor(role, [1]);
      expect(hasGrant(agent.permissions, 'documents.sensitive.read', 'own')).toBe(false);
      expect(await ids(agent, 'documents', [idDoc])).toEqual([]);
      expect(await ids(agent, 'files', [idFile])).toEqual([]);
      expect(await lastFours(agent, idDoc)).toEqual([]);
    }
  });

  it('keeps no column that could hold more of a number than its last four digits', async () => {
    const columns = await withoutContext<{ column_name: string }>(sql`
      select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'identity_documents' order by 1`);
    expect(columns.map((c) => c.column_name)).toEqual([
      'account_id',
      'created_at',
      'created_by',
      'document_id',
      'entity_id',
      'id',
      'kind',
      'last4',
      'masked_file_id',
    ]);
    for (const last4 of ['01234', '234567890123', '12a4']) {
      expect(
        await failure(
          asMigrator(
            (m) => m`insert into identity_documents (id, entity_id, account_id, document_id, kind,
                                                     last4, masked_file_id, created_by)
              values (${newId()}, 1, ${account}, ${idDoc}, 'aadhaar', ${last4}, ${idFile}, ${owner.id})`,
          ),
        ),
      ).toContain('identity_documents_last4_check');
    }
  });

  it('keeps identity and bank papers sensitive, whoever writes them', async () => {
    const file = await documentFile(1, account, owner.id);
    expect(
      await failure(
        asMigrator(
          (m) => m`insert into documents (id, entity_id, account_id, kind, file_id, sensitive,
                                          filed_by_kind, filed_by)
            values (${newId()}, 1, ${account}, 'bank_proof', ${file}, false, 'person', ${owner.id})`,
        ),
      ),
    ).toContain('documents_sensitive_check');
  });
});

describe('an upload of a customer document names a customer the uploader may file for', () => {
  const tryUpload = (principal: Principal, account: string | null, entityId = 1) =>
    asPrincipal(principal, ({ tx }) => {
      const id = newId();
      return tx.execute(sql`insert into files (id, entity_id, purpose, bucket, key, name,
                                               content_type, size, sha256, status, account_id,
                                               created_by)
        values (${id}, ${entityId}, 'customer_document', 'test', ${`files/${id}.jpg`}, 'p.jpg',
                'image/jpeg', 1, ${SHA}, 'pending', ${account}, ${principal.id})`);
    }).then(
      () => true,
      () => false,
    );

  it.each(STAFF_ROLE_KEYS)(
    '%s uploads for a customer as its documents.write scope allows',
    async (role) => {
      const principal = await createTestPrincipal(role, [1]);
      const theirs = await customer(principal.id);
      const someoneElse = await createTestPrincipal('tele_caller_cc', [1]);
      const others = await customer(someoneElse.id);
      const own = hasGrant(principal.permissions, 'documents.write', 'own');
      const entity = hasGrant(principal.permissions, 'documents.write', 'entity');
      expect({ role, theirs: await tryUpload(principal, theirs) }).toEqual({ role, theirs: own });
      expect({ role, others: await tryUpload(principal, others) }).toEqual({
        role,
        others: entity,
      });
    },
  );

  it('refuses one naming no customer, or a customer the company does not know', async () => {
    const manager = await createTestPrincipal('project_manager', [1, 2]);
    const onlyIn2 = await customer(manager.id, [2]);
    expect(await tryUpload(manager, null)).toBe(false);
    expect(await tryUpload(manager, onlyIn2, 1)).toBe(false);
    expect(await tryUpload(manager, onlyIn2, 2)).toBe(true);
  });

  it('lets no other purpose name a customer', async () => {
    const executive = await createTestPrincipal('executive', [1]);
    const account = await customer(executive.id);
    expect(
      await failure(
        asMigrator(
          (m) => m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size,
                                      sha256, status, account_id, created_by)
            values (${newId()}, 1, 'consent_evidence', 'test', ${`files/${newId()}.jpg`}, 'p.jpg',
                    'image/jpeg', 1, ${SHA}, 'pending', ${account}, ${executive.id})`,
        ),
      ),
    ).toContain('files_account_check');
  });

  it('shows the uploader their upload until it is filed, then only through its document', async () => {
    const engineer = await createTestPrincipal('field_engineer', [1]);
    const account = await customer(engineer.id);
    const file = await documentFile(1, account, engineer.id);
    expect(await ids(engineer, 'files', [file])).toEqual([file]);
    // Filed as an identity paper by someone who may, the engineer no longer reads it.
    const manager = await createTestPrincipal('project_manager', [1]);
    await fileDirectly(1, account, file, 'identity_proof', manager.id);
    expect(await ids(engineer, 'files', [file])).toEqual([]);
    expect(await ids(principalFor('project_manager', [1]), 'files', [file])).toEqual([file]);
  });
});

describe('filing and unfiling under row security', () => {
  const insertDocument = (
    principal: Principal,
    values: { account: string; file: string; kind: string; sensitive: boolean; filedBy?: string },
  ) =>
    asPrincipal(principal, ({ tx }) =>
      tx.execute(sql`insert into documents (id, entity_id, account_id, kind, file_id, sensitive,
                                            filed_by_kind, filed_by)
        values (${newId()}, 1, ${values.account}, ${values.kind}, ${values.file}, ${values.sensitive},
                'person', ${values.filedBy ?? principal.id})`),
    ).then(
      () => true,
      () => false,
    );

  it('files a sensitive document only with documents.sensitive.read, and only as oneself', async () => {
    const gm = await createTestPrincipal('general_manager', [1]);
    const manager = await createTestPrincipal('project_manager', [1]);
    const account = await customer(gm.id);
    const file = await documentFile(1, account, gm.id);
    expect(
      await insertDocument(gm, { account, file, kind: 'identity_proof', sensitive: true }),
    ).toBe(false);
    expect(
      await insertDocument(manager, {
        account,
        file,
        kind: 'electricity_bill',
        sensitive: false,
        filedBy: gm.id,
      }),
    ).toBe(false);
    expect(
      await insertDocument(manager, { account, file, kind: 'identity_proof', sensitive: true }),
    ).toBe(true);
  });

  it('unfiles once, hides the identity document, and lets the file be filed again', async () => {
    const manager = await createTestPrincipal('project_manager', [1]);
    const account = await customer(manager.id);
    const file = await documentFile(1, account, manager.id);
    const document = await fileDirectly(1, account, file, 'identity_proof', manager.id);
    expect(await lastFours(manager, document)).toEqual(['0123']);
    const unfile = () =>
      asPrincipal(manager, ({ tx }) =>
        tx.execute(sql`update documents set unfiled_at = now(), unfiled_by = ${manager.id},
                                            unfiled_reason = 'filed against the wrong step'
                        where id = ${document}`),
      );
    await unfile();
    expect(await lastFours(manager, document)).toEqual([]);
    // Already unfiled: the policy no longer finds it, and the owner's guard refuses it too.
    await unfile();
    expect(
      await failure(
        asMigrator(
          (m) =>
            m`update documents set unfiled_reason = 'changed afterwards' where id = ${document}`,
        ),
      ),
    ).toContain('an unfiled document stays unfiled');
    expect(
      await insertDocument(manager, { account, file, kind: 'identity_proof', sensitive: true }),
    ).toBe(true);
  });
});

describe('requirements and the completeness check (PRJ-03)', () => {
  it('lets only an Executive add or change a requirement; every principal of the company reads them', async () => {
    const executive = await createTestPrincipal('executive', [1]);
    const gm = await createTestPrincipal('general_manager', [1]);
    const write = (principal: Principal) =>
      asPrincipal(principal, ({ tx }) =>
        tx.execute(sql`update document_requirements set position = position, updated_by = ${principal.id}
                        where entity_id = 1 returning id`),
      ).then((rows) => (rows as unknown as unknown[]).length);
    expect(await write(gm)).toBe(0);
    expect(await write(executive)).toBeGreaterThan(0);
    const [seen] = (await asPrincipal(principalFor('field_engineer', [1]), ({ tx }) =>
      tx.execute(sql`select count(*)::int as n from document_requirements where entity_id = 1`),
    )) as unknown as { n: number }[];
    expect(seen?.n).toBeGreaterThan(0);
  });

  it('answers the mandatory keys not yet filed, counting a sensitive document its caller cannot read', async () => {
    const manager = await createTestPrincipal('project_manager', [1]);
    const account = await customer(manager.id);
    const missing = (principal: Principal) =>
      asPrincipal(principal, ({ tx }) =>
        tx.execute(sql`select app.documents_missing(1::smallint, ${account}::uuid, null::uuid,
                                                    'standard', 'survey') as keys`),
      ).then((rows) => (rows as unknown as { keys: string[] }[])[0]?.keys);
    expect(await missing(manager)).toEqual(['electricity_bill', 'identity_proof', 'site_photos']);
    await fileDirectly(
      1,
      account,
      await documentFile(1, account, manager.id),
      'identity_proof',
      manager.id,
    );
    await fileDirectly(
      1,
      account,
      await documentFile(1, account, manager.id),
      'electricity_bill',
      manager.id,
    );
    // The General Manager reads no identity paper, yet it counts as filed.
    expect(await missing(principalFor('general_manager', [1]))).toEqual(['site_photos']);
  });

  it('refuses the check to a caller with neither documents.read nor projects.read, or in another company', async () => {
    const account = newId();
    const call = (principal: Principal) =>
      asPrincipal(principal, ({ tx }) =>
        tx.execute(sql`select app.documents_missing(1::smallint, ${account}::uuid, null::uuid,
                                                    'standard', 'survey')`),
      );
    expect(await failure(call(principalFor('inventory_manager', [1])))).toContain(
      'documents_missing needs',
    );
    expect(await failure(call(principalFor('project_manager', [2])))).toContain(
      'documents_missing needs',
    );
  });
});
