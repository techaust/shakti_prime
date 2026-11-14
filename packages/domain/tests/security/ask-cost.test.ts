import type { Principal } from '@shakti/contracts';
import { asMigrator, closeDb, createTestPrincipal } from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { askTheBusiness } from '../../src/ai/ask/ask';
import { recordedAskTransport, type AskRecording } from '../../src/ai/ask/recorded';
import { createAiProvider } from '../../src/ai/provider';
import { fakeModelTransport, type ModelRequest, type ModelTransport } from '../../src/ai/transport';
import { memoryKeyValue } from '../../src/ports/key-value';
import { memoryLogger } from '../../src/ports/logger';
import { removeAskData, seedAskData, type AskData } from '../fixtures/ask-data';

// The acceptance of Ask the Business (docs/03-roadmap-appendix/phase2.md §6.5, CLAUDE.md "Cost
// data isolation"): the same questions asked as a General Manager and as an Executive, on seeded
// data that holds an item's cost and last purchase rate, and an Executive-only file stating a
// supplier's rate, a job's cost and a margin. The model is the worst case: a recording that asks
// for every lookup that could touch them and writes back every figure it read. No cost, margin or
// supplier rate reaches the General Manager's lookups, answer, stored message or log lines; the
// Executive, who holds `finance.cost.read` and reads Executive files, gets them.

let data: AskData;
let executive: Principal;
let gm: Principal;
const conversations: string[] = [];

beforeAll(async () => {
  executive = await createTestPrincipal('executive', [1]);
  gm = await createTestPrincipal('general_manager', [1]);
  data = await seedAskData(executive.id);
});

afterAll(async () => {
  await asMigrator((m) => m`delete from ask_conversations where id = any(${conversations})`);
  await removeAskData();
  await closeDb();
});

/** Every figure a recorded model read, written back as its answer: the worst a model could do. */
function echoEverything(tag: string): AskRecording {
  return {
    lookups: [
      { name: 'find_items', input: { query: tag } },
      { name: 'search_vault', input: { query: `${tag} pump kit costing supplier rate margin` } },
      { name: 'read_playbook', input: {} },
      { name: 'dealer_credit', input: {} },
    ],
    // Everything it read about the tagged records (the rest of the database is left out, so the
    // answer stays within its stored length).
    answer: (results) =>
      `Everything I read: ${JSON.stringify(results, (_key, value: unknown) =>
        Array.isArray(value)
          ? value.filter(
              (v: unknown) =>
                typeof v !== 'object' ||
                v === null ||
                !('ref' in v) ||
                JSON.stringify(v).includes(tag),
            )
          : value,
      )}`,
  };
}

const QUESTIONS = (tag: string) => [
  `What do we pay for the ${tag} pump?`,
  `What is our margin and supplier rate on the ${tag} kit?`,
];

interface Asked {
  lookups: string;
  answers: string;
  stored: string;
  logs: string;
}

async function askAs(principal: Principal): Promise<Asked> {
  const requests: ModelRequest[] = [];
  const recorded = recordedAskTransport(() => echoEverything(data.tag));
  const transport: ModelTransport = {
    complete(request, signal) {
      requests.push(request);
      return recorded.complete(request, signal);
    },
  };
  const logger = memoryLogger();
  const provider = createAiProvider({
    claude: transport,
    voyage: fakeModelTransport(),
    keyValue: memoryKeyValue(),
    logger,
  });
  const answers: string[] = [];
  for (const question of QUESTIONS(data.tag)) {
    const turn = await askTheBusiness(
      principal,
      { question },
      { provider, logger },
      { entityIds: [1] },
    );
    conversations.push(turn.conversation.id);
    answers.push(turn.message.answer);
  }
  const stored = await asMigrator(
    (m) => m<{ question: string; answer: string; cited: unknown; returned: unknown }[]>`
      select question, answer, cited_json as cited, returned_json as returned
        from ask_messages where conversation_id = any(${conversations.slice(-2)})`,
  );
  return {
    lookups: requests
      .flatMap((r) => r.rounds ?? [])
      .flatMap((round) => round.results.map((x) => x.content))
      .join('\n'),
    answers: answers.join('\n'),
    stored: JSON.stringify(stored),
    logs: JSON.stringify(logger.entries),
  };
}

describe('the same questions as a General Manager and as an Executive (phase2 §6.5 acceptance)', () => {
  it('give the Executive the costs, the supplier rate and the margin they may read', async () => {
    const asked = await askAs(executive);
    expect(asked.lookups).toContain('"movingAverageCost":"₹31250.50"');
    expect(asked.lookups).toContain('"lastPurchaseRate":"₹29875.00"');
    expect(asked.lookups).toContain('₹27,640');
    expect(asked.lookups).toContain('23.5 percent');
    expect(asked.answers).toMatch(/31250\.5/);
    expect(asked.answers).toMatch(/27,640/);
    expect(asked.stored).toMatch(/31250\.5/);
  });

  it('never give the General Manager a cost, a margin or a supplier rate: not in a lookup, the answer, the stored message or a log line', async () => {
    const asked = await askAs(gm);
    // The General Manager's lookups ran and read what they may: the item without its cost side,
    // the staff and management rules, no Executive file.
    expect(asked.lookups).toContain(data.tag.toUpperCase());
    expect(asked.lookups).toContain(data.managementRuleId);
    expect(asked.lookups).not.toContain('movingAverageCost');
    expect(asked.lookups).not.toContain('lastPurchaseRate');
    expect(asked.lookups).not.toContain(data.vaultFileId);
    expect(asked.lookups).not.toContain('supplier rate is');
    // Dealer credit is not a lookup a General Manager has.
    expect(asked.lookups).not.toContain('creditLimit');
    for (const pattern of data.costPatterns) {
      expect({ pattern: String(pattern), lookups: pattern.test(asked.lookups) }).toEqual({
        pattern: String(pattern),
        lookups: false,
      });
      expect(pattern.test(asked.answers)).toBe(false);
      expect(pattern.test(asked.stored)).toBe(false);
      expect(pattern.test(asked.logs)).toBe(false);
    }
  });
});
