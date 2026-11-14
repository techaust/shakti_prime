import { newId } from '@shakti/contracts';
import { asMigrator } from '@shakti/db/testing';
import { fakeEmbedding } from '../../src/ai/transport';

// Seeded data for Ask the Business's suites (docs/03-roadmap-appendix/phase2.md §14), written as
// the owner in company 1 under this run's own words, so no earlier run's rows meet it: an item
// with a cost side (a moving average cost and a last purchase rate, which only `finance.cost.read`
// reads), an Executive-only vault file stating a supplier's rate, a job's cost and a margin, a
// management rule and a staff rule. Every value is synthetic test data, never copy.

export interface AskData {
  tag: string;
  itemId: string;
  vaultFileId: string;
  staffRuleId: string;
  managementRuleId: string;
  /** The cost figures, as the database holds them and as a reader would write them. */
  costs: {
    movingAverage: string;
    lastPurchase: string;
    supplierRate: string;
    jobCost: string;
    margin: string;
  };
  /** Every way those figures could be written, which must never reach a General Manager. */
  costPatterns: readonly RegExp[];
}

const made = {
  items: [] as string[],
  files: [] as string[],
  vault: [] as string[],
  rules: [] as string[],
};

export async function seedAskData(ownerId: string): Promise<AskData> {
  const tag = `asktag${newId().replace(/-/g, '').slice(-10)}`;
  const itemId = newId();
  const upload = newId();
  const vaultFileId = newId();
  const staffRuleId = newId();
  const managementRuleId = newId();
  const passage = `Synthetic ${tag} pump kit costing: the supplier rate is ₹27,640 a kit, the job cost of one installation is ₹41,385 and our margin is 23.5 percent.`;
  await asMigrator(async (m) => {
    await m`insert into items (id, sku, name, category, hsn, unit)
      values (${itemId}, ${tag.toUpperCase()}, ${`Synthetic ${tag} pump`}, 'pump', '8413', 'nos')`;
    await m`insert into item_costs (id, item_id, entity_id, moving_avg_cost, last_purchase_rate, as_of)
      values (${newId()}, ${itemId}, 1, 31250.5000, 29875.0000, now())`;
    await m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
      values (${upload}, 1, 'knowledge', 'test', ${`1/knowledge/${upload}.pdf`}, 'costing.pdf',
              'application/pdf', 10, ${'d'.repeat(64)}, 'ready', ${ownerId})`;
    await m`insert into knowledge_files (id, entity_id, file_id, title, sensitivity, source_type, state, chunks, created_by)
      values (${vaultFileId}, 1, ${upload}, ${`Synthetic ${tag} costing`}, 'exec_only', 'pdf', 'indexed', 1, ${ownerId})`;
    await m`insert into knowledge_chunks (id, knowledge_file_id, entity_id, sensitivity, position, chunk_text, embedding)
      values (${newId()}, ${vaultFileId}, 1, 'exec_only', 0, ${passage},
              ${JSON.stringify(fakeEmbedding(passage))}::vector)`;
    await m`insert into playbook_directives (id, entity_id, type, audience, title, text, state,
                                             approved_by, approved_at, checked_at, created_by) values
      (${staffRuleId}, 1, 'policy', 'staff', ${`Synthetic ${tag} installation`},
       ${`Install every ${tag} pump within 30 days of the order.`}, 'approved', ${ownerId}, now(), now(), ${ownerId}),
      (${managementRuleId}, 1, 'priority', 'management', ${`Synthetic ${tag} priority`},
       ${`Follow up every ${tag} dealer within 7 days.`}, 'approved', ${ownerId}, now(), now(), ${ownerId})`;
  });
  made.items.push(itemId);
  made.files.push(upload);
  made.vault.push(vaultFileId);
  made.rules.push(staffRuleId, managementRuleId);
  return {
    tag,
    itemId,
    vaultFileId,
    staffRuleId,
    managementRuleId,
    costs: {
      movingAverage: '31250.5000',
      lastPurchase: '29875.0000',
      supplierRate: '27,640',
      jobCost: '41,385',
      margin: '23.5',
    },
    costPatterns: [/31,?250/, /29,?875/, /27,?640/, /41,?385/, /23\.5/],
  };
}

export async function removeAskData(): Promise<void> {
  await asMigrator(async (m) => {
    await m`delete from playbook_directives where id = any(${made.rules})`;
    await m`delete from knowledge_chunks where knowledge_file_id = any(${made.vault})`;
    await m`delete from knowledge_files where id = any(${made.vault})`;
    await m`delete from files where id = any(${made.files})`;
    await m`delete from item_costs where item_id = any(${made.items})`;
    await m`delete from items where id = any(${made.items})`;
  });
}
