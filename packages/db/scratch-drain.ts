// Scratch measurement for DATA-2 (not committed): the drain time of a 50,000-event backlog.
import postgres from 'postgres';
import { claimOutbox, closeOutboxDb } from './src/outbox-client';
import { runOutboxPublisher } from '../domain/src/outbox/publisher';
import { memoryEventPublisher } from '../domain/src/ports/event-publisher';

const N = 50_000;
const m = postgres(process.env.DATABASE_URL_MIGRATOR ?? '', { max: 1 });
const tag = `drain_${Date.now()}`;

async function seed(type: string, payload: string) {
  await m.unsafe(`
    insert into outbox_events (id, entity_id, type, aggregate_type, aggregate_id, payload_json)
    select app.uuid_v7(), 1, '${type}', '${tag}', g::text, '${payload}'::jsonb
      from generate_series(1, ${N}) g`);
}
const pending = async () =>
  (await m`select count(*)::int as n from outbox_events where aggregate_type = ${tag} and published_at is null and dead_lettered_at is null`)[0]?.n as number;

// Before: imported leads pending, one claim of 100 per call (the minute schedule).
await seed('crm.lead.created', '{"v":1,"pipelineKey":"pump","sourceCode":null,"existingAccount":false,"imported":true}');
let t = performance.now();
const one = await runOutboxPublisher({ claim: claimOutbox, publisher: memoryEventPublisher() });
const oneMs = performance.now() - t;
console.log(JSON.stringify({ phase: 'before: one call', counts: one, ms: Math.round(oneMs), left: await pending() }));

// After, the loop: the same backlog drained by calls of a 30-second budget.
let calls = 0;
t = performance.now();
while ((await pending()) > 0 && calls < 100) {
  await runOutboxPublisher({ claim: claimOutbox, publisher: memoryEventPublisher(), budgetMs: 30_000 });
  calls += 1;
}
console.log(JSON.stringify({ phase: 'after: loop, imported (skipped)', calls, ms: Math.round(performance.now() - t), left: await pending() }));

// After, the loop over events that are sent (an instant queue).
await seed('platform.probe.requested', `{"v":1,"requestedAt":"${new Date().toISOString()}"}`);
calls = 0;
t = performance.now();
while ((await pending()) > 0 && calls < 100) {
  await runOutboxPublisher({ claim: claimOutbox, publisher: memoryEventPublisher(), budgetMs: 30_000 });
  calls += 1;
}
console.log(JSON.stringify({ phase: 'after: loop, sent events', calls, ms: Math.round(performance.now() - t), left: await pending() }));
await m.end();
await closeOutboxDb();
