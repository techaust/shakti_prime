# Spike: Exotel click-to-dial on 140 and 160 numbers

**Status (04-10-2026):** ready to run; waits for the Exotel sandbox with DLT numbers in the group's account (client-actions 17). Owner: the developer. The wrapper, the calling rules and the callback check are built and tested with fixtures; nothing has called Exotel yet.
**Roadmap:** §2 week 6 · **Blueprint:** §10, §9.3 guardrails · **Security:** §7 · **API:** §3.4 `POST /webhooks/exotel/call-status`

## 1. What is built
| Piece | Where |
|---|---|
| Calling rules as pure functions: 09:00 to 21:00 IST; promotional calls only from a 140-series number and never to a number on DND; service calls only from a 160-series number and only with recorded consent (DND does not block a consented service call); recipients must be Indian mobiles; every broken rule is listed | `packages/domain/src/telecom/dial-policy.ts` (`checkDial`, `withinCallingHours`, `numberSeries`, `nextCallingWindowStart`) |
| Click-to-dial wrapper: `POST /v1/Accounts/{sid}/Calls/connect.json` with basic auth, 8 s timeout, never retried (a timeout does not prove the phones did not ring); `checkDial` runs first and a refused dial never reaches Exotel; status read with two retries | `apps/web/src/integrations/exotel/client.ts` |
| Callback verification: Exotel posts no signature header, so each dial gets its own StatusCallback address carrying the BOS call id, an expiry (24 h) and an HMAC-SHA256 of both under `EXOTEL_CALLBACK_SECRET`; the worker also matches the CallSid to the stored call. JSON and form bodies are read through the published `ExotelCallStatusWebhook` contract (`packages/contracts/src/api/webhooks-exotel.ts`). | `apps/web/src/integrations/exotel/status-callback.ts` |
| Fixture tests (dial form, auth, error codes, no retry on dial, retry on read, refusals, signed address, JSON and form callbacks) | `apps/web/src/integrations/exotel/exotel.test.ts`, `packages/domain/src/telecom/dial-policy.test.ts` |
| Spike script | `apps/web/scripts/spike/exotel-dial.ts`, run with `pnpm --filter web spike:exotel` (`-- --dry-run` checks the rules only) |

Not built, by design: the webhook route, `webhook_inbox` and the dial command (Phase 2). The `calls` table exists since slice T1, which logs calls dialled by hand; the dialler's provider call id, recording and transcript columns join it in Phase 2. DND scrubbing itself (the NCPR lookup) is an input to `checkDial`; the scrub provider is chosen with the DLT registration.

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
