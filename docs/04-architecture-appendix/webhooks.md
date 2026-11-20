# Webhooks under load, the Lead Ads lead and the queue's batch call

The record of the G2 measures of the webhook backbone (P5, [design §5.1](../03-roadmap-appendix/phase2.md#51-p5-webhook-backbone) and [§8.1](../03-roadmap-appendix/phase2.md#81-g2-phase-2-exit-pack)), I1's Lead Ads path ([§6.2](../03-roadmap-appendix/phase2.md)) and the queue's batch call at 200 messages. The commands are in `apps/web/tests/measures/` (`g2.ts`, run with `pnpm --filter web exec tsx tests/measures/g2.ts <measure>`); their arithmetic is `apps/web/scripts/measures/stats.ts`, unit tested. Nothing here runs in CI, and a base address off the machine is refused without `--hosted-run-approved`, which only the owner's go-ahead allows.

## Measured (G2)

**Run of 20-11-2026**, in a cloud VM (4 processors, Intel Xeon at 2.1 GHz, 16 GB), on branch `feat/g2-measures` (measuring code at 58720fdf; product code unchanged from `main` at 889ec54d), against one `pnpm build` served by `next start` on the same VM with the journeys' settings, the webhook test phrases and the local Docker Postgres. Locally there is no queue, so the server processes each delivery itself after answering, on the same processors as the answers; on Vercel the worker is a function of its own.

### Webhook answers under load: blocked by a defect
Open-loop runs of 30 seconds at 20, 50 and 100 deliveries a second, the six providers' recorded payloads in turn, one delivery in ten a repeat; each answer timed from the send to the end of its body. Target: every answer within 2 seconds (the route's own budget, §5.1), read at the longest, and every delivery stored once.

- **Missed: five of the six routes answer 500 and store nothing on the production build.** `meta/whatsapp`, `meta/leadgen`, `google/leadform`, `exotel/call-status` and `livekit` fail every delivery with `TypeError: Cannot convert undefined or null to object` (`request.failed` in the server's log); only `exotel/incoming/[secret]` works. Cause: `paramsOf()` in `apps/web/src/webhooks/receive.ts` calls `Object.entries()` on the route's `params`, which Next.js resolves to `undefined` for a route with no dynamic segment; the suites call the handlers directly with no context, so they never reach that line. The fix is outside this slice (product code); it is reported in the [run file](../runs/phase2/g2-measures.md). Until it is fixed, the measure stands as below.

| Rate | Deliveries | p50 ms | p95 ms | p99 ms | Longest ms | Answered 200 | Stored once |
|---|---|---|---|---|---|---|---|
| 20/s, all six | 600 | 5.3 | 10 | 54 | 303 | 120 (Passthru only) | 100 of 540 distinct (Passthru's) |
| 50/s, all six | 1,500 | 3.6 | 8.0 | 12 | 34 | 300 | 250 of 1,350 |
| 100/s, all six | 3,000 | 2.8 | 6.8 | 13 | 66 | 600 | 500 of 2,700 |

The 500s are the refusal path's time, not the store's, so these figures do not measure the six routes.

**The one route that works, Exotel's Passthru, alone** (the same runs with `--providers exotel_incoming`: the signature check, the store as `webhook_receiver`, the answer):

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
- Repeats were answered 200 and stored nothing more.

### The Lead Ads event to the caller's lead: met
`g2.ts lead`: I1's in-process path (the route's own `receiveWebhook()`, stored, processed after the answer with no queue, `crm.lead.ingest`, the lead given to the company's one present caller), with a stand-in for Meta's Graph API answering the recorded lead; timed until that caller's own lead search, under row-level security, finds it by phone. Target: within 10 seconds (PRD CRM-01).

| Graph's answer | Rounds | p50 ms | p95 ms | Longest ms | Route answered (p50) | Result |
|---|---|---|---|---|---|---|
| at once | 20 | 63 | 86 | 177 | 2.7 ms | met |
| 1 second (`--graph-ms 1000`) | 10 | 1,087 | 1,158 | 1,158 | 3.2 ms | met |

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
1. **Webhooks on dev**, once the defect above is fixed and deployed, the receiver's role is set on dev (`DATABASE_URL_WEBHOOKS`, `WEBHOOK_RECEIVER_PASSWORD`) and dev's webhook phrases are in the runner's environment (`WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `META_LEADGEN_APP_SECRET`, `META_LEADGEN_VERIFY_TOKEN`, `GOOGLE_LEADFORM_KEY`, `EXOTEL_CALLBACK_SECRET`, `EXOTEL_INCOMING_SECRET`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`):
   `pnpm --filter web exec tsx tests/measures/g2.ts webhooks --base-url https://shakti-prime-dev.vercel.app --hosted-run-approved --providers meta_whatsapp,exotel_status,exotel_incoming,livekit`
   The two lead-form providers are left out because the recorded forms are connected to no company on dev: each delivery would be set aside as `form_unmapped` with an error line to Sentry. The stored-once count is not made against dev (no database access); Integration health's webhook counts show it. QStash then processes the rows, so a run of 100 a second for 30 seconds is about 3,000 QStash messages.
2. **Lead Ads on dev**: no command; Meta's Lead Ads testing tool on the developer app's test Page, with the Page subscribed to dev's `meta/leadgen` route and its form connected on dev, timed from the tool's send to the lead on the caller's board (I1's final-phase step, design §12). Waits on the defect's fix and Meta's app keys on dev.
3. **The batch call against QStash**: no command (the measure reaches no vendor); the sweep's and the publisher's own runs on dev log each call's outcome. Waits on dev's QStash token and a backlog of 200 waiting rows.
