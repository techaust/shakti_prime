import { newId, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  createTestPrincipal,
  createTestTeam,
  createTestUser,
  PIPELINE_SEED,
  testPhone,
} from '@shakti/db/testing';
import { executeCommand, executeQuery, searchLeads, setIngestSource } from '@shakti/domain';
import { createHmac } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { percentiles, shareWithin, type Percentiles } from '../../scripts/measures/stats';
import { fieldCipher, resetFieldCipher } from '../../src/crypto/kms-cipher';
import leadFixture from '../../src/integrations/meta-leadgen/fixtures/lead.json';
import type { MetaLeadClient } from '../../src/integrations/meta-leadgen/client';
import { WEBHOOK_VERIFIERS } from '../../src/webhooks/providers';
import { receiveWebhook } from '../../src/webhooks/receive';
import { TEST_ORIGIN, TEST_WEBHOOK_ENV } from '../../src/webhooks/signed-deliveries';
import { metaLeadgenHandler } from '../../src/workers/webhooks/lead-forms';
import { processWebhook } from '../../src/workers/webhooks/process';
import { WEBHOOK_HANDLERS } from '../../src/workers/webhooks/registry';

/**
 * The Lead Ads test event to a lead a caller can see (docs/03-roadmap-appendix/phase2.md §6.2 and
 * §8.1, PRD CRM-01: within 10 seconds), on I1's in-process path: the signed `leadgen` delivery
 * through the route's own `receiveWebhook`, stored as `webhook_receiver`, processed after the
 * answer with no queue (as locally and in CI), the lead read from a stand-in of Meta's Graph API
 * that answers the recorded lead (no Meta call), made by `crm.lead.ingest` and given to the
 * company's present caller; timed until that caller's own lead search (under RLS) finds it by
 * its phone. Graph's own answer time is not in the figure unless `graphMs` adds one; the hosted
 * run with Meta's Lead Ads testing tool includes it.
 */

export const LEAD_TARGET_MS = 10_000;
/** Company 3, as I1's own test, with a pipeline of the seed. */
const ENTITY = 3;
const POLL_MS = 25;
const GIVE_UP_MS = 30_000;
const QUEUE = [
  'QSTASH_TOKEN',
  'QSTASH_CURRENT_SIGNING_KEY',
  'QSTASH_NEXT_SIGNING_KEY',
  'QSTASH_URL',
];

export interface LeadPathResult {
  rounds: number;
  graphMs: number;
  /** From the delivery's send to the route's answer. */
  answer: Percentiles;
  /** From the delivery's send to the caller's search finding the lead. */
  visible: Percentiles;
  within10s: number;
  /** Rounds whose lead did not appear within 30 seconds. */
  lost: number;
}

/** Meta's lead, as the Graph API answers it, with this round's phone. */
function graphStandIn(phones: Map<string, string>, graphMs: number): MetaLeadClient {
  return {
    async fetchLead(leadgenId) {
      if (graphMs > 0) await sleep(graphMs);
      const phone = phones.get(leadgenId) ?? '+919000000023';
      return {
        ...leadFixture,
        id: leadgenId,
        field_data: leadFixture.field_data.map((f) =>
          f.name === 'phone_number' ? { ...f, values: [phone] } : f,
        ),
      };
    },
  };
}

function leadgenRequest(formId: string, leadgenId: string): Request {
  const body = JSON.stringify({
    object: 'page',
    entry: [
      {
        id: '104000000000001',
        time: Math.floor(Date.now() / 1000),
        changes: [
          {
            field: 'leadgen',
            value: {
              leadgen_id: leadgenId,
              form_id: formId,
              page_id: '104000000000001',
              ad_id: '666666666666',
              adgroup_id: '777777777777',
              created_time: Math.floor(Date.now() / 1000),
            },
          },
        ],
      },
    ],
  });
  const signature = `sha256=${createHmac('sha256', TEST_WEBHOOK_ENV.META_LEADGEN_APP_SECRET)
    .update(body)
    .digest('hex')}`;
  return new Request(`${TEST_ORIGIN}/api/v1/webhooks/meta/leadgen`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
  });
}

/** Meta's ids are digits: a run's own, after every earlier run's. */
let serial = Date.now() * 1000;
const metaId = (): string => String((serial += 1));

async function prepare(): Promise<{
  caller: Principal;
  formId: string;
  restore: () => Promise<void>;
}> {
  const pumps = PIPELINE_SEED.find((p) => p.key === 'farmer_pumps');
  if (pumps === undefined) throw new Error('the seeded pipelines are missing');
  const exec = await createTestPrincipal('executive', [ENTITY]);
  const team = await createTestTeam(ENTITY, 'g2 lead measure team');
  const user = await createTestUser([
    { entityId: ENTITY, roleKey: 'tele_caller_cc', teamId: team },
  ]);
  const caller = await createTestPrincipal('tele_caller_cc', [ENTITY], {
    id: user.id,
    teamId: team,
  });
  // The measure's caller is the one present, so each lead is theirs; the others' presence is put
  // back afterwards.
  const present = await asMigrator(
    (m) => m<{ id: string }[]>`
      update caller_profiles set presence = 'away'
       where entity_id = ${ENTITY} and presence = 'present' returning id`,
  );
  await asMigrator(
    (m) => m`insert into caller_profiles (id, user_id, entity_id, presence)
             values (${newId()}, ${caller.id}, ${ENTITY}, 'present')`,
  );
  const formId = metaId();
  const cipher = fieldCipher();
  await executeCommand(
    exec,
    { entityIds: [ENTITY] },
    setIngestSource,
    {
      entityId: ENTITY,
      provider: 'meta_leadgen',
      externalId: formId,
      name: `G2 measure form ${formId}`,
      pipelineId: pumps.id,
      fieldMap: {
        full_name: 'fullName',
        phone_number: 'phone',
        zip_code: 'pin',
        city: 'village',
        borewell_depth_in_feet: 'pumpDepthFt',
        monthly_electricity_bill: 'monthlyBillRupees',
      },
      consent: {
        questionKey: 'call_consent',
        textVersion: 'v2',
        channels: ['call', 'whatsapp'],
        purpose: 'service',
      },
      pageToken: `EAAG${newId().replaceAll('-', '')}`,
    },
    cipher === undefined ? {} : { fieldCipher: cipher },
  );
  const restore = async () => {
    const ids = present.map((p) => p.id);
    await asMigrator(async (m) => {
      await m`update caller_profiles set presence = 'away'
               where entity_id = ${ENTITY} and user_id = ${caller.id}`;
      if (ids.length > 0) {
        await m`update caller_profiles set presence = 'present' where id = any(${ids})`;
      }
    });
  };
  return { caller, formId, restore };
}

/** `rounds` Lead Ads events, one after another, each timed to the lead in the caller's search. */
export async function measureLeadPath(options: {
  rounds: number;
  graphMs: number;
}): Promise<LeadPathResult> {
  for (const name of QUEUE) Reflect.deleteProperty(process.env, name);
  Object.assign(process.env, TEST_WEBHOOK_ENV);
  // Locally the field cipher is a key of the developer's; a hosted runtime refuses one.
  process.env.FIELD_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
  resetFieldCipher();

  const { caller, formId, restore } = await prepare();
  const phones = new Map<string, string>();
  const meta = graphStandIn(phones, options.graphMs);
  const handlers = {
    ...WEBHOOK_HANDLERS,
    meta_leadgen: metaLeadgenHandler(() => ({ meta, cipher: () => fieldCipher() })),
  };
  const route = receiveWebhook('meta_leadgen', WEBHOOK_VERIFIERS.meta_leadgen, {
    deps: { process: (inboxId, o) => processWebhook(inboxId, { ...o, handlers }) },
  });

  const answers: number[] = [];
  const visible: number[] = [];
  let lost = 0;
  try {
    for (let round = 0; round < options.rounds; round += 1) {
      const leadgenId = metaId();
      const digits = testPhone();
      phones.set(leadgenId, `+91${digits}`);
      const request = leadgenRequest(formId, leadgenId);
      const t0 = performance.now();
      const answer = await route(request);
      answers.push(performance.now() - t0);
      if (answer.status !== 200) throw new Error(`the route answered ${String(answer.status)}`);
      let seen = false;
      while (performance.now() - t0 < GIVE_UP_MS) {
        const hits = await executeQuery(
          caller,
          { entityIds: [ENTITY] },
          (ctx) => searchLeads(ctx, { q: digits, limit: 1 }),
          { name: 'searchLeads' },
        );
        if (hits.length > 0) {
          visible.push(performance.now() - t0);
          seen = true;
          break;
        }
        await sleep(POLL_MS);
      }
      if (!seen) lost += 1;
    }
  } finally {
    await restore();
  }
  return {
    rounds: options.rounds,
    graphMs: options.graphMs,
    answer: percentiles(answers),
    visible: percentiles(visible),
    within10s: shareWithin(visible, LEAD_TARGET_MS),
    lost,
  };
}
