import { COST_PERMISSIONS, hasGrant, newId, type Principal } from '@shakti/contracts';
import { asMigrator, closeDb, createTestPrincipal } from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { voiceSessionPrincipal } from '../../src/auth/voice-principal';
import { executeCommand, executeQuery } from '../../src/command/execute';
import { startVoiceSession } from '../../src/commands/voice/sessions';

// SECURITY §3.4, settled by V2 (docs/03-roadmap-appendix/phase2.md §7.5): a voice session acts as
// its person but never carries a cost permission, even for an Executive, so a spoken answer never
// reads out a cost or a supplier's rate. The same Executive reads the item's cost on their own
// session and nothing through their voice session, under the same policies.

let executive: Principal;
let voice: Principal;
const itemId = newId();
const costId = newId();

beforeAll(async () => {
  executive = await createTestPrincipal('executive', [1]);
  const grant = await executeCommand(executive, { entityIds: [1] }, startVoiceSession, {
    mode: 'ask',
    consentRecording: false,
  });
  const built = voiceSessionPrincipal(executive, grant.sessionId, grant.entity_ids);
  if (built === undefined) throw new Error('no voice principal');
  voice = built;
  await asMigrator(async (m) => {
    await m`insert into items (id, sku, name, category, hsn, unit)
            values (${itemId}, ${`VC-${itemId.slice(-8)}`}, 'voice cost item', 'pump', '8413', 'nos')`;
    await m`insert into item_costs (id, item_id, entity_id, moving_avg_cost, last_purchase_rate, as_of)
            values (${costId}, ${itemId}, 1, 4321.0000, 4567.0000, now())`;
  });
});

afterAll(async () => {
  await asMigrator(async (m) => {
    await m`delete from item_costs where id = ${costId}`;
    await m`delete from items where id = ${itemId}`;
  });
  await closeDb();
});

const readCost = (principal: Principal) =>
  executeQuery(
    principal,
    { entityIds: [1] },
    async ({ tx }) =>
      (await tx.execute(
        sql`select moving_avg_cost, last_purchase_rate from item_costs where id = ${costId}`,
      )) as unknown as { moving_avg_cost: string; last_purchase_rate: string }[],
    { name: 'voiceCostRead' },
  );

describe('a voice session principal', () => {
  it("holds the Executive's grants but neither cost permission", () => {
    for (const key of COST_PERMISSIONS) {
      expect(hasGrant(executive.permissions, key, 'entity')).toBe(true);
      expect(hasGrant(voice.permissions, key, 'own')).toBe(false);
    }
    expect(voice).toMatchObject({ id: executive.id, kind: 'voice_session', roleKey: 'executive' });
    expect(hasGrant(voice.permissions, 'voice.use', 'all')).toBe(true);
  });

  it("is refused the cost read the same Executive's own session is allowed", async () => {
    expect(await readCost(executive)).toEqual([
      { moving_avg_cost: '4321.0000', last_purchase_rate: '4567.0000' },
    ]);
    expect(await readCost(voice)).toEqual([]);
  });
});
