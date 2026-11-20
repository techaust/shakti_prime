# Spike: Exotel click-to-dial on 140 and 160 numbers

**Status (04-10-2026):** ready to run; waits for the Exotel sandbox with DLT numbers in the group's account (client-actions 17). Owner: the developer. The wrapper, the calling rules and the callback check are built and tested with fixtures; nothing has called Exotel yet.
**Roadmap:** §2 week 6 · **Blueprint:** §10, §9.3 guardrails · **Security:** §7 · **API:** §3.4 `POST /webhooks/exotel/call-status`

## 1. What is built
| Piece | Where |
|---|---|
| Calling rules as pure functions: 09:00 to 21:00 IST; promotional calls only from a 140-series number and never to a number on DND, or whose DND state could not be had fresh (`dnd_unknown`); service calls only from a 160-series number and only with recorded consent (DND does not block a consented service call); never to a customer who withdrew consent to calls; only on a number the company has for the purpose; recipients must be Indian mobiles; every broken rule is listed | `packages/domain/src/telecom/dial-policy.ts` (`checkDial`, `withinCallingHours`, `numberSeries`, `nextCallingWindowStart`) |
| The call's purpose and its number (E1): service only with a service consent for calls and an order, a callback the customer asked for, or an enquiry the customer made, else promotional; the company's 160 or 140 number from `entity_channels`; the facts read as the caller through `app.dial_facts()`; a DND check older than 7 days looked up again for a promotional call through the `DndRegistry` port (the fixture register on local, CI, dev and staging; none on production until the scrub service is chosen) and recorded by the platform (`crm.phone.dnd_record`) | `packages/domain/src/telecom/call-purpose.ts`, `dial-plan.ts` (`planDial`, `prepareDial`), `packages/domain/src/ports/dnd.ts`, `apps/web/src/integrations/dnd/registry.ts`, the `planCall` action |
| Click-to-dial wrapper: `POST /v1/Accounts/{sid}/Calls/connect.json` with basic auth, 8 s timeout, never retried (a timeout does not prove the phones did not ring); `checkDial` runs first and a refused dial never reaches Exotel; status read with two retries | `apps/web/src/integrations/exotel/client.ts` |
| Callback verification: Exotel posts no signature header, so each dial gets its own StatusCallback address carrying the BOS call id, an expiry (24 h) and an HMAC-SHA256 of both under `EXOTEL_CALLBACK_SECRET`; the worker also matches the CallSid to the stored call. JSON and form bodies are read through the published `ExotelCallStatusWebhook` contract (`packages/contracts/src/api/webhooks-exotel.ts`). | `apps/web/src/integrations/exotel/status-callback.ts` |
| Fixture tests (dial form, auth, error codes, no retry on dial, retry on read, refusals, signed address, JSON and form callbacks) | `apps/web/src/integrations/exotel/exotel.test.ts`, `packages/domain/src/telecom/dial-policy.test.ts` |
| Spike script | `apps/web/scripts/spike/exotel-dial.ts`, run with `pnpm --filter web spike:exotel` (`-- --dry-run` checks the rules only) |

Built in Phase 2 beside the spike: the webhook route and `webhook_inbox` (P5); the dial (`calls.call.dial` through `placeDial` and the `ClickToDial` port, `apps/web/src/integrations/exotel/click-to-dial.ts`), `provider_calls`, the `exotel_status` handler with the recording's copy, and the hourly sweep (T3, [phase 2 design §6.3](../03-roadmap-appendix/phase2.md#63-t3-click-to-dial-and-recordings)). The dial asks Exotel for the `answered` status too, besides `terminal`. A click-to-dial call connects two numbers and has no flow before the caller is joined, so the recording notice cannot play; until a flow is attached (connecting the caller to a flow whose Connect applet asks the BOS which customer to ring, not built), calls are placed unrecorded and the caller says the notice. Step 2's "the recording notice plays" waits for that flow. DND scrubbing is the `DndRegistry` port (E1); the scrub provider behind it is chosen with the DLT registration.

## 2. What the user supplies
1. An Exotel account on the Mumbai cluster with KYC done, and its **Account SID, API key and API token** (Settings › API).
2. The entity's **DLT registration** (Principal Entity) and at least one **ExoPhone in the 140 series** and one in the **160 series** mapped to it. Until the 160 number is allotted, only the promotional path can be run.
3. **Two phones you hold**: one acting as the tele-caller (rung first), one as the customer. Neither may be a customer's number.
4. A value for `EXOTEL_CALLBACK_SECRET`: at least 32 random characters, generated on your machine, never committed.
5. An https address that receives the status callback for inspection (`EXOTEL_SPIKE_CALLBACK_BASE`), for example a tunnel to a local listener; the route itself arrives in Phase 2. The script requires it, even for `--dry-run`, and reads the final state by polling as well, so the result does not depend on the callback arriving.

Environment for the script: `EXOTEL_ACCOUNT_SID`, `EXOTEL_API_KEY`, `EXOTEL_API_TOKEN`, `EXOTEL_SUBDOMAIN` (optional, default `api.in.exotel.com`), `EXOTEL_CALLBACK_SECRET`, `EXOTEL_SPIKE_AGENT_NUMBER`, `EXOTEL_SPIKE_CUSTOMER_NUMBER`, `EXOTEL_SPIKE_CALLER_ID`, `EXOTEL_SPIKE_PURPOSE` (`promotional` or `service`), `EXOTEL_SPIKE_CONSENT=yes` for a service call, `EXOTEL_SPIKE_ON_DND=yes` to test a DND refusal, `EXOTEL_SPIKE_CALLBACK_BASE`.

## 3. Steps
1. `pnpm --filter web spike:exotel -- --dry-run` between 09:00 and 21:00 IST: prints `calling rules: allowed`. Run it once after 21:00 too and confirm `outside_calling_hours`.
2. Promotional run with the 140 number: `EXOTEL_SPIKE_PURPOSE=promotional`, `EXOTEL_SPIKE_CALLER_ID=<140 number>`. Answer the first phone, then the second; check the second phone shows the 140 number and the recording notice plays (IVR flow set in Exotel). Hang up.
3. Service run with the 160 number and `EXOTEL_SPIKE_CONSENT=yes`.
4. Refusals: the 160 number with `promotional`, the 140 number with `service`, and `EXOTEL_SPIKE_ON_DND=yes` with `promotional` must each stop before dialling.
5. Inspect the callback that reached `EXOTEL_SPIKE_CALLBACK_BASE`: note its content type, fields (CallSid, Status, ConversationDuration, RecordingUrl, CustomField, Legs) and whether any signature header is present. Update `parseStatusCallback` if a field differs.
6. Save each stdout report under `docs/04-architecture-appendix/exotel/` with the date and record the results below.

## 4. Pass criteria
- A call connects the two phones showing the entity's 140 number (promotional) and 160 number (service).
- The recording notice plays; the recording link arrives in the callback.
- Every refusal case stops before Exotel is called.
- The callback arrives on the signed address and names the call; the final state matches what happened (completed, no-answer, busy).
- Dial accepted in under 2 s from Mumbai (recorded as `dialAcceptedMs`).

## 5. Results
Not run yet.

## Measured (G2)
**Run of 20-11-2026**, in a cloud VM (4 processors, Intel Xeon at 2.1 GHz, 16 GB), on branch `feat/g2-measures` (measuring code at 0bea4de0 for the dial, 58720fdf for the screen-pop; product code unchanged from `main` at 889ec54d), against one `pnpm build` served by `next start` on the same VM with the journeys' settings and seed (`pnpm --filter web e2e:seed`), in headless Chromium signed in through the screens. Nothing hosted was called; no phone rang. The commands are `apps/web/tests/measures/g2.ts` ([webhooks.md](webhooks.md) has the rest of the G2 measures).

**The dial accepted: met.** `pnpm --filter web exec tsx tests/measures/g2.ts dial`: the journeys' tele-caller, a new lead each round, from the `C` key in the Cold Caller workspace to the call bar showing the call accepted ("Ringing", or a later state), on T3's simulated provider (no Exotel account is set locally). Target: under 2 seconds (design §8.1), read at p95.

| Rounds | p50 ms | p95 ms | Longest ms | The dial action's answer (p50, p95) | Result |
|---|---|---|---|---|---|
| 10 | 195 | 239 | 239 | 116 ms, 172 ms | met |

Exotel's own acceptance of the call is not in the figure: the simulated provider answers at once. One earlier run of the same command stopped on a 30-second wait in one round and did not recur in the two runs after it.

**The screen-pop by the poll: missed.** `pnpm --filter web exec tsx tests/measures/g2.ts screen-pop`: the journeys' screen-pop caller waiting on `/home`; Exotel's Passthru call on the real route at a random moment of the 3-second poll, from a number two of her customers share; timed from the Passthru call to the ringing route's answer carrying it. Target: TEL-05's 2 seconds (design §7.4), read at p95.

| Transport | Calls | p50 ms | p95 ms | Longest ms | Within 2 s | Passthru answered (p50) | Result |
|---|---|---|---|---|---|---|---|
| The 3-second poll | 30 | 1,650 | 2,938 | 3,030 | 18 of 30 | 10 ms | missed |

The step that misses is the poll's own wait (up to 3 seconds); the server's part, the Passthru call stored and the pop held, is about 10 ms. This agrees with T4's run of 17-11-2026, and with the owner's decision of 18-11-2026 that Realtime is the transport that meets the 2 seconds, with the poll as the fallback. The Realtime figure waits for dev ([realtime.md](realtime.md)).

**Hosted runs still to make** (each the owner's go-ahead):
1. The dial on dev: `pnpm --filter web exec tsx tests/measures/g2.ts dial --base-url https://shakti-prime-dev.vercel.app --hosted-run-approved --rounds 10`, with `G2_DIAL_EMAIL`, `G2_DIAL_PASSWORD` (a tele-caller of company 1 on dev) and `G2_DIAL_PHONE` (their own phone, which rings) set, between 9 AM and 9 PM in India. Waits on the Exotel sandbox keys and the DLT numbers mapped on dev (a hosted runtime has no simulated provider). Each round adds a lead named "Measure Dial" on dev.
2. The screen-pop on dev: `pnpm --filter web exec tsx tests/measures/g2.ts screen-pop --base-url https://shakti-prime-dev.vercel.app --hosted-run-approved --rounds 30`, with `G2_POP_EMAIL`, `G2_POP_PASSWORD`, `EXOTEL_INCOMING_SECRET`, `G2_POP_CALL_TO` (company 1's incoming calls number), `G2_POP_DIAL_WHOM` (the caller's own phone) and `G2_POP_CALL_FROM` (a number two of the caller's customers share), each as Exotel's Passthru writes it (national form with its leading 0). Waits on Realtime on dev (see [realtime.md](realtime.md)).
