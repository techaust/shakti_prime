# Webhooks under load, the Lead Ads lead and the queue's batch call

The record of the G2 measures of the webhook backbone (P5, [design §5.1](../03-roadmap-appendix/phase2.md#51-p5-webhook-backbone) and [§8.1](../03-roadmap-appendix/phase2.md#81-g2-phase-2-exit-pack)), I1's Lead Ads path ([§6.2](../03-roadmap-appendix/phase2.md)) and the queue's batch call at 200 messages. The commands are in `apps/web/tests/measures/` (`g2.ts`, run with `pnpm --filter web exec tsx tests/measures/g2.ts <measure>`); their arithmetic is `apps/web/scripts/measures/stats.ts`, unit tested. Nothing here runs in CI, and a base address off the machine is refused without `--hosted-run-approved`, which only the owner's go-ahead allows.

## Measured (G2)

**Runs of 20-11-2026**, in a cloud VM (4 processors, Intel Xeon at 2.1 GHz, 16 GB), on branch `feat/g2-measures` (each run's commit is named with it), against a `pnpm build` served by `next start` on the same VM with the journeys' settings, the webhook test phrases, no vendor credential and the local Docker Postgres. Locally there is no queue, so the server processes each delivery itself after answering, on the same processors as the answers; on Vercel the worker is a function of its own. Each run's `--out` report is in [results/g2-2026-11-20/](results/g2-2026-11-20/), numbered in the order of the runs below.

The runs leave rows on the local database: the lead forms' recorded deliveries are set aside as `form_unmapped` (failed rows on Integration health's list) and the processed rows stay for 90 days. The journeys and their screenshot baselines then need a fresh database (`fresh-db.sh`), never the one the measures ran on.

### Webhook answers under load, first run: blocked by a defect (fixed the same day, below)
At 58720fdf (product code `main`'s 889ec54d; reports 1 to 3). Open-loop runs of 30 seconds at 20, 50 and 100 deliveries a second, the six providers' recorded payloads in turn, one delivery in ten a repeat; each answer timed from the send to the end of its body. Target: every answer within 2 seconds (the route's own budget, §5.1), read at the longest, and every delivery stored once.

- **Missed: until 35305e13, five of the six routes answered 500 and stored nothing on the production build.** `meta/whatsapp`, `meta/leadgen`, `google/leadform`, `exotel/call-status` and `livekit` failed every delivery with `TypeError: Cannot convert undefined or null to object` (`request.failed` in the server's log); only `exotel/incoming/[secret]` worked. Cause: `paramsOf()` in `apps/web/src/webhooks/receive.ts` called `Object.entries()` on the route's `params`, which Next.js resolves to `undefined` for a route with no dynamic segment; the suites called the handlers directly with no context, so they never reached that line. Fixed in 35305e13 on the same branch (`fix(webhooks): a route with no path parameter gets no params from Next.js`, the lead's decision on the [run file](../runs/phase2/g2-measures.md)'s question); the run after it is below.

| Rate | Deliveries | p50 ms | p95 ms | p99 ms | Longest ms | Answered 200 | Stored once |
|---|---|---|---|---|---|---|---|
| 20/s, all six | 600 | 5.3 | 10 | 54 | 303 | 120 (Passthru only) | 100 of 540 distinct (Passthru's) |
| 50/s, all six | 1,500 | 3.6 | 8.0 | 12 | 34 | 300 | 250 of 1,350 |
| 100/s, all six | 3,000 | 2.8 | 6.8 | 13 | 66 | 600 | 500 of 2,700 |

The 500s were the failure path's time, not the store's, so these figures do not measure the six routes.

**The one route that worked then, Exotel's Passthru, alone** (the same runs with `--providers exotel_incoming`: the signature check, the store as `webhook_receiver`, the answer):

| Rate | Processing | Deliveries | p50 ms | p95 ms | p99 ms | Longest ms | Stored once | Target |
|---|---|---|---|---|---|---|---|---|
| 20/s | in the server after each answer | 600 | 6.9 | 11 | 65 | 344 | 540 of 540 | met |
| 50/s | in the server | 1,500 | 4.7 | 7.2 | 13 | 39 | 1,350 of 1,350 | met |
| 100/s | in the server | 3,000 | 3.8 | 7.2 | 21 | 53 | 2,700 of 2,700 | met |
| 20/s | held off (published to a local queue stand-in) | 600 | 8.8 | 14 | 96 | 394 | 540 of 540 | met |
| 50/s | held off | 1,500 | 6.3 | 10 | 19 | 51 | 1,350 of 1,350 | met |
| 100/s | held off | 3,000 | 4.9 | 8.7 | 23 | 71 | 2,700 of 2,700 | met |

- With processing held off (`--queue stand-in`: the server publishes each new row to a local stand-in of QStash, as a hosted server publishes, and processes none; the stand-in counted 4,590 publishes, one per distinct delivery), the answer includes that publish, as it does on Vercel, which is why it is a millisecond or two slower than answering and processing later.
- In every run the generator kept its plan (send lag p99 at most 1 ms), so the figures are the server's. The first rate of each run carries the server's warm-up (the 300 to 400 ms longest answers at 20/s); later rates do not.
- Every repeat (all of them Passthru's here) was answered 200 and stored nothing more.

### Webhook answers under load, after the fix: met
**Run of 20-11-2026**, same VM, on branch `feat/g2-measures` at 6a36b166 (the fix 35305e13 included; a new `pnpm build`), the same command at the same rates for all six providers, once with processing in the server and once held off (`--queue stand-in`, 4,590 publishes, one per distinct delivery; the measure then marks its own held-off rows processed on the local database, so no backlog is left for the sweep).

| Rate | Processing | Deliveries | p50 ms | p95 ms | p99 ms | Longest ms | Answered 200 | Stored once | Target |
|---|---|---|---|---|---|---|---|---|---|
| 20/s | in the server | 600 | 8.3 | 18 | 232 | 406 | all | 540 of 540 | met |
| 50/s | in the server | 1,500 | 5.6 | 10 | 23 | 43 | all | 1,350 of 1,350 | met |
| 100/s | in the server | 3,000 | 4.9 | 11 | 30 | 61 | all | 2,700 of 2,700 | met |
| 20/s | held off | 600 | 10 | 18 | 140 | 428 | all | 540 of 540 | met |
| 50/s | held off | 1,500 | 7.2 | 12 | 27 | 73 | all | 1,350 of 1,350 | met |
| 100/s | held off | 3,000 | 6.3 | 13 | 28 | 82 | all | 2,700 of 2,700 | met |

- Per provider at 100 a second, in the server (p50 / p99 / longest, ms): WhatsApp 4.8 / 25 / 52; Lead Ads 4.9 / 32 / 50; Google 4.8 / 31 / 50; Exotel status 5.0 / 26 / 41; Exotel Passthru 4.7 / 30 / 48; LiveKit 5.2 / 28 / 61. Held off: WhatsApp 6.1 / 29 / 82; Lead Ads 6.3 / 27 / 74; Google 6.1 / 25 / 72; Exotel status 6.4 / 31 / 82; Exotel Passthru 6.1 / 20 / 74; LiveKit 6.8 / 29 / 72.
- At 100 a second the server's own processing did not make the answers miss: the longest answer was 61 ms with it and 82 ms held off, where each answer also waits for its publish to the queue, as on Vercel. The 20-a-second rows carry the server's warm-up (every provider's p99 and longest fall at the higher rates).
- The generator kept its plan (send lag p99 at most 2 ms). Every repeat was answered 200 and stored nothing more, but these runs' repeats reached only three providers (WhatsApp, Google and Passthru: one delivery in ten went five back, and 5 and 10 against 6 providers land on the same three; review M1), so the next runs repeat every provider.

### After the fix, with repeats to every provider: met
At 5b47262e and after (the repeats chosen by `repeatSources()`, unit tested; the held-off rows settled in a `finally`; reports 6 to 8), the same build (product code at 35305e13). Each provider was sent 10, 25 and 50 repeats at 20, 50 and 100 a second, and every one was answered 200 and stored nothing more. The in-server load ran twice, at f4be1dee and again at 5fd98d7e, since the first run's 20-a-second row was far above the earlier runs'.

| Rate | Processing | Deliveries | Repeats | p50 ms | p95 ms | p99 ms | Longest ms | Answered 200 | Stored once | Target |
|---|---|---|---|---|---|---|---|---|---|---|
| 20/s | in the server, first run | 600 | 60 | 9.8 | 293 | 1,096 | 1,413 | all | 540 of 540 | met |
| 50/s | in the server, first run | 1,500 | 150 | 6.2 | 11 | 23 | 39 | all | 1,350 of 1,350 | met |
| 100/s | in the server, first run | 3,000 | 300 | 5.0 | 17 | 103 | 257 | all | 2,700 of 2,700 | met |
| 20/s | in the server, second run | 600 | 60 | 8.4 | 17 | 150 | 380 | all | 540 of 540 | met |
| 50/s | in the server, second run | 1,500 | 150 | 5.6 | 9.4 | 15 | 67 | all | 1,350 of 1,350 | met |
| 100/s | in the server, second run | 3,000 | 300 | 4.6 | 9.6 | 24 | 51 | all | 2,700 of 2,700 | met |
| 20/s | held off | 600 | 60 | 10 | 24 | 223 | 454 | all | 540 of 540 | met |
| 50/s | held off | 1,500 | 150 | 7.3 | 12 | 18 | 47 | all | 1,350 of 1,350 | met |
| 100/s | held off | 3,000 | 300 | 6.6 | 13 | 26 | 87 | all | 2,700 of 2,700 | met |

- The first in-server run's 20-a-second row came closest to the 2 seconds (longest 1,413 ms, in the server's first seconds after it started); its second run and every other run stayed under 460 ms. The target was met in all, but the margin at a cold start is not wide on this VM, and a hosted run is the one that settles it.
- The held-off runs answered each delivery after publishing it to the stand-in, as on Vercel (4,590 publishes, one per distinct delivery).

### The Lead Ads event to the caller's lead: met

### The Lead Ads event to the caller's lead: met
`g2.ts lead`: I1's in-process path (the route's own `receiveWebhook()`, stored, processed after the answer with no queue, `crm.lead.ingest`, the lead given to the company's one present caller), with a stand-in for Meta's Graph API answering the recorded lead; timed until that caller's own lead search, under row-level security, finds it by phone. Target: within 10 seconds (PRD CRM-01).

| Run | Graph's answer | Rounds | Lost | p50 ms | p95 ms | Longest ms | Route answered (p50) | Result |
|---|---|---|---|---|---|---|---|---|
| 58720fdf (reports `lead-1`) | at once | 20 | 0 | 63 | 86 | 177 | 2.7 ms | met |
| 58720fdf | 1 second (`--graph-ms 1000`) | 10 | 0 | 1,087 | 1,158 | 1,158 | 3.2 ms | met |
| 9bf82036 and after (`lead-2`) | at once | 20 | 0 | 84 | 202 | 515 | 4.7 ms | met |
| 9bf82036 and after | 1 second | 10 | 0 | 1,126 | 1,228 | 1,228 | 4.2 ms | met |

A lead the caller's search has not found within 30 seconds is lost, and from 9bf82036 counts as 30 seconds in the figures, so a lost round makes the target missed (review M2); no round was lost.

Graph's own time is a stand-in's here; the client allows it 4 seconds and one retry, so even a slow Graph keeps the lead within the 10 seconds by this path's own share (under 0.2 s).

### The queue's batch call at 200 messages: the app's side only
`g2.ts outbox`: the outbox publisher's `qstashEventPublisher().publish()` and the webhook sweep's `publishWebhookJobs()`, each with 200 messages through `@upstash/qstash`'s own client, 20 rounds each, against a local stand-in that records the calls and accepts every message. QStash's dev server is a separate download (`@upstash/qstash-cli`), not in this repository, so QStash's own time and its limits are not measured here. No target: the figures are the app's side and the request's size.

| Call | p50 ms | p95 ms | Longest ms | Body | Messages a call | All accepted |
|---|---|---|---|---|---|---|
| Outbox publisher (events to their queue groups) | 5.7 | 13 | 48 | 123,301 bytes | 200 | yes (plus 2 queue-group calls once per process) |
| Webhook sweep (process jobs) | 3.6 | 7.2 | 7.9 | 75,801 bytes | 200 | yes |

One call carries all 200 messages; the outbox claims 100 a run (`OUTBOX_BATCH_SIZE`), so its real calls are half this size.

### Hosted runs still to make
Each is the owner's go-ahead; none was made by this slice.
1. **Webhooks on dev**, once the fix (35305e13) is on `main` and deployed to dev, the receiver's role is set on dev (`DATABASE_URL_WEBHOOKS`, `WEBHOOK_RECEIVER_PASSWORD`) and dev's webhook phrases are in the runner's environment (`WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `META_LEADGEN_APP_SECRET`, `META_LEADGEN_VERIFY_TOKEN`, `GOOGLE_LEADFORM_KEY`, `EXOTEL_CALLBACK_SECRET`, `EXOTEL_INCOMING_SECRET`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`):
   `pnpm --filter web exec tsx tests/measures/g2.ts webhooks --base-url https://shakti-prime-dev.vercel.app --hosted-run-approved --providers meta_whatsapp,exotel_status,exotel_incoming,livekit`
   The two lead-form providers are left out because the recorded forms are connected to no company on dev: each delivery would be set aside as `form_unmapped` with an error line to Sentry. The stored-once count is not made against dev (no database access); Integration health's webhook counts show it. Every distinct delivery is one QStash message to the worker: the three rates for 30 seconds each are about 4,600 messages, and `--rates 100` alone about 2,700. On dev each answer also waits for its publish to QStash, whose region is the EU, a cross-region call from Mumbai that the local stand-in does not have, so dev's answers will be slower than the held-off rows above by that call's time.
2. **Lead Ads on dev**: no command; Meta's Lead Ads testing tool on the developer app's test Page, with the Page subscribed to dev's `meta/leadgen` route and its form connected on dev, timed from the tool's send to the lead on the caller's board (I1's final-phase step, design §12). Waits on the fix deployed to dev and Meta's app keys on dev.
3. **The batch call against QStash**: no command (the measure reaches no vendor); the sweep's and the publisher's own runs on dev log each call's outcome. Waits on dev's QStash token and a backlog of 200 waiting rows.
