# Spike: WhatsApp Cloud API send and receive

**Status:** ready to run. The send wrapper and the webhook checks are built and tested with fixtures; nothing has called Meta yet.
**Roadmap:** §2 week 6 · **Blueprint:** §10 · **API:** §3.4 `GET/POST /webhooks/meta/whatsapp`, §6 · **Security:** §7

## 1. What is built
| Piece | Where |
|---|---|
| Send wrapper: approved template with body values, and text inside the 24-hour window, to `POST {graph}/{version}/{phone-number-id}/messages` with the system-user key; 10 s timeout; never retried (a timeout does not prove Meta did not deliver); Meta's error code and subcode reported, the body never logged; Graph version pinned (`v23.0` unless `WHATSAPP_GRAPH_VERSION` says otherwise) | `apps/web/src/integrations/whatsapp/client.ts` |
| Webhook checks: the verify-token handshake (`hub.mode=subscribe`, constant-time phrase check, echo `hub.challenge`), `X-Hub-Signature-256` over the exact raw body with the app secret, and a reader for inbound messages, delivery states with failure codes, and template approvals; the query and body are read through the published contracts (`MetaVerifyQuery`, `MetaSignatureHeaderSchema`, `WhatsAppWebhook` in `packages/contracts/src/api/webhooks-meta.ts`) | `apps/web/src/integrations/whatsapp/webhook.ts` |
| Fixture tests (template and text request shapes, error mapping, handshake, signature on raw bytes versus a re-serialised body, event parsing) | `apps/web/src/integrations/whatsapp/whatsapp.test.ts` with `fixtures/*.json` |
| Spike script: `send` (template, then optional text, timed) and `listen` (a local receiver that answers the handshake, checks signatures and prints ids and states, never bodies) | `apps/web/scripts/spike/whatsapp.ts`, run with `pnpm --filter web spike:whatsapp -- send` or `-- listen` |

Not built, by design: the webhook route, `webhook_inbox`, `whatsapp_messages` and the messaging worker with its window, opt-out, template and tier checks (Phase 2, docs/API.md §6).

## 2. What the user supplies
1. A **Meta developer app** of type Business with the WhatsApp product added, linked to the Shakti **Business portfolio** (business verification can follow; the test number works before it).
2. From the app's WhatsApp › API Setup page: the **test phone number id** (`WHATSAPP_PHONE_NUMBER_ID`) and up to five **recipient numbers you hold**, added there as allowed recipients (`WHATSAPP_SPIKE_TO`, E.164 digits without a plus).
3. A **system-user access key** with `whatsapp_business_messaging` and `whatsapp_business_management` (`WHATSAPP_ACCESS_TOKEN`). The temporary 24-hour key from the setup page is enough for one run.
4. The **app secret** (App settings › Basic, `WHATSAPP_APP_SECRET`) and a **verify phrase** you choose (`WHATSAPP_VERIFY_TOKEN`).
5. For `listen`: a tunnel you run (for example `cloudflared tunnel --url http://localhost:8787`) and its https address registered as the webhook callback in the app, subscribed to `messages` and `message_template_status_update`.

Optional: `WHATSAPP_SPIKE_TEMPLATE`, `WHATSAPP_SPIKE_TEMPLATE_LANGUAGE`, `WHATSAPP_SPIKE_TEMPLATE_PARAMS` (values separated by `|`) for a template of your own once one is approved; `WHATSAPP_SPIKE_TEXT` for a text send; `WHATSAPP_SPIKE_PORT` (default 8787).

## 3. Steps
1. Start the receiver: `pnpm --filter web spike:whatsapp -- listen`, start the tunnel, register the callback in the Meta app. The receiver prints `handshake answered`.
2. Send: `pnpm --filter web spike:whatsapp -- send`. The recipient phone gets `hello_world`; the receiver prints `status … sent`, then `delivered`, then `read` when opened.
3. Reply from the phone. The receiver prints `message wamid… type text`. Within 24 hours of that reply, set `WHATSAPP_SPIKE_TEXT` and send again: the text arrives.
4. Tamper check: resend a captured delivery with one byte changed (or a wrong secret) and confirm `delivery refused: bad signature`.
5. Save the stdout reports under `docs/spikes/whatsapp/` with the date and record results below.

## 4. Pass criteria
- Template and text sends are accepted and delivered; acceptance time recorded.
- The handshake succeeds only with the verify phrase.
- Every genuine delivery passes the signature check; a changed body or a wrong secret fails it.
- Inbound message, status (sent, delivered, read, failed) and template events parse into ids and states.

## 5. Results
Not run yet.
