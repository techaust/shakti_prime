// J3's document journeys (`e2e/documents.spec.ts`), written by the seed on the host: in company 1,
// customers the Field Engineer looks after. The first has a bill and an identity paper already
// filed by the Project Manager, each a test picture kept as a checked, masked customer document,
// the identity paper with its last four digits only; each project's own customer is the one the
// Project Manager uploads to. Made once with fixed ids and dates, so the screenshots hold still.
import { asMigrator } from '@shakti/db/testing';
import { createHash } from 'node:crypto';
import { fileStore } from '../../src/files/store';
import { solidPng } from '../support/png';
import { DOCUMENTS_JOURNEY } from '../support/users';

const id = (n: number) => `0199e2e0-0000-7000-8000-0000000d${n.toString(16).padStart(4, '0')}`;

const IDS = {
  billFile: id(0x0101),
  idFile: id(0x0102),
  bill: id(0x0201),
  identity: id(0x0202),
  identityNumber: id(0x0301),
};

/** The day the fixtures are stamped with, so no screenshot shows the day the seed ran. */
const SEEDED_AT = '2026-04-01T10:00:00+05:30';

export async function ensureDocumentJourneys(engineerId: string, managerId: string): Promise<void> {
  const store = fileStore();
  if (store === undefined) throw new Error('no local file store for the document journeys');
  const { entityId, filed, uploads } = DOCUMENTS_JOURNEY;
  const pictures = [
    {
      fileId: IDS.billFile,
      bytes: solidPng(240, 160, [230, 230, 230]),
      name: 'Electricity bill.png',
    },
    { fileId: IDS.idFile, bytes: solidPng(240, 160, [20, 20, 20]), name: 'Identity proof.png' },
  ];
  // The bytes again on every run: the local store may have been cleared since.
  for (const p of pictures) {
    await store.put(
      `${String(entityId)}/customer_document/${p.fileId}-checked.png`,
      p.bytes,
      'image/png',
    );
  }
  const customers = [{ accountId: filed.accountId, name: filed.name }, ...Object.values(uploads)];
  await asMigrator((m) =>
    m.begin(async (tx) => {
      for (const c of customers) {
        await tx`insert into accounts (id, type, name, created_by, created_at, updated_at)
          values (${c.accountId}, 'household', ${c.name}, ${engineerId}, ${SEEDED_AT}, ${SEEDED_AT})
          on conflict (id) do nothing`;
        await tx`insert into account_entities (id, account_id, entity_id, owner_id, created_by)
          values (${c.accountId}, ${c.accountId}, ${entityId}, ${engineerId}, ${engineerId})
          on conflict (account_id, entity_id) do update set owner_id = excluded.owner_id`;
      }
      for (const p of pictures) {
        const scan = {
          verdict: 'not_scanned',
          sanitising: 'masked',
          regionsMasked: 1,
          lastFour: {
            aadhaar: p.fileId === IDS.idFile ? [filed.lastFour] : [],
            bankAccount: [],
          },
        };
        await tx`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size,
                                    sha256, status, scan_result, account_id, created_by,
                                    created_at, updated_at)
          values (${p.fileId}, ${entityId}, 'customer_document', ${store.bucket},
                  ${`${String(entityId)}/customer_document/${p.fileId}-checked.png`}, ${p.name},
                  'image/png', ${p.bytes.length},
                  ${createHash('sha256').update(p.bytes).digest('hex')}, 'ready', ${tx.json(scan)},
                  ${filed.accountId}, ${managerId}, ${SEEDED_AT}, ${SEEDED_AT})
          on conflict (id) do nothing`;
      }
      await tx`insert into documents (id, entity_id, account_id, requirement_key, kind, file_id,
                                      sensitive, filed_by_kind, filed_by, filed_at, updated_at)
        values (${IDS.bill}, ${entityId}, ${filed.accountId}, 'electricity_bill', 'electricity_bill',
                ${IDS.billFile}, false, 'person', ${managerId}, ${SEEDED_AT}, ${SEEDED_AT}),
               (${IDS.identity}, ${entityId}, ${filed.accountId}, 'identity_proof', 'identity_proof',
                ${IDS.idFile}, true, 'person', ${managerId}, ${SEEDED_AT}, ${SEEDED_AT})
        on conflict (id) do nothing`;
      await tx`insert into identity_documents (id, entity_id, account_id, document_id, kind, last4,
                                               masked_file_id, created_by, created_at)
        values (${IDS.identityNumber}, ${entityId}, ${filed.accountId}, ${IDS.identity}, 'aadhaar',
                ${filed.lastFour}, ${IDS.idFile}, ${managerId}, ${SEEDED_AT})
        on conflict (id) do nothing`;
    }),
  );
}
