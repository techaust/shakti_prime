# Security — Shakti Prime BOS

Blueprint reference: §7, §9.3, §12. This document is the working security specification: threat model, identity, the permission catalogue, data isolation, data protection, AI and telecom compliance, application and infrastructure security, and operations. `docs/BLUEPRINT.md` governs on any conflict.

## 1. Threat model
**Assets:** customer PII and KYC documents; supplier rates, costs and margins; price lists; Tally financial mirrors; call recordings and WhatsApp conversations; the Executive Knowledge Vault; credentials and API keys; the integrity of stock, money and state.

**Actors and trust boundaries:**
| Actor | Trust | Main risks |
|---|---|---|
| Staff users (11 roles) | Authenticated, least privilege | Over-privileged reads, cross-entity access, export leakage |
| Customers on WhatsApp | Untrusted | Prompt injection, spam, document spoofing, social engineering of the Concierge |
| Providers (Meta, Exotel, Google, LiveKit) | Verified by signature, otherwise untrusted | Forged webhooks, replay |
| Tally connector | Signed, outbound only | Key theft on the client PC, tampered batches |
| AI agents | Internal service principals | Acting beyond autonomy, leaking cost data, runaway spend |
| Overseas AI vendors | Contracted processors | Retention of PII, model misuse |
| Developers and operators | Trusted with audit | Key-person risk, secret sprawl |

**Boundaries enforced in code and in the database:** RLS per entity; two cost permissions; command-only mutations; webhook inbox; masked LLM inputs; DTO whitelists.

## 2. Identity and authentication
- **Passwords:** Argon2id (m = 64 MiB, t = 3, p = 1); minimum 12 characters; breached-password check.
- **Bot and brute-force controls:** Cloudflare Turnstile on login and public forms. The exponential lockout in Redis applies to one account from one address, so a stranger who knows an email cannot keep its owner out and one office address is not locked for everyone behind it; the account-wide count only escalates, emailing the owner at every tenth failure; per-address request caps bound what one address tries across accounts; an Executive can lift an account's locks. The trade-off: a spread-out guessing attempt meets Turnstile, the caps and the owner's alert rather than a hard lock. A suspended account locks like an active one, so the lock does not reveal it, and no session is created for an inactive user.
- **Sessions:** database sessions with rotation on privilege change; idle timeout 12 h; absolute 7 d; admins can force logout; a role change revokes sessions. A revoked or expired session is refused on every auth route and in-process call, not only in `currentPrincipal()`; no device is ever remembered past the second factor. The session token column is readable by the auth module's database role only; application code sees session metadata, never the token. The session cookie is `__Host-` prefixed in production. Per-address request caps bound the password-hashing and mail-sending endpoints on top of the sign-in lockout.
- **Cookies:** HttpOnly, Secure, SameSite=Lax, `__Host-` prefix.
- **2FA:** TOTP required for Executive, GM and Accounts; each code verifies once; five wrong codes lock the second factor for an hour; the sign-in lock clears and the last sign-in is recorded only after the second factor; recovery codes; recovery email via SES only; a user who has lost both the app and the backup codes is reset by an Executive (`admin.user.two_factor.reset`, never their own account) only after the Executive has confirmed who is asking by phone or in person, and the reset signs the user out everywhere, emails them and makes them set up a new app at the next sign-in.
- **Set-password links:** stored hashed; an invitation lasts 24 h and a forgotten-password link 1 h; a new link withdraws the person's earlier ones; attempts are capped per link and per address. Staff ask for a new link on the "Forgot your password?" screen (Turnstile, the same answer whether or not the email has an account); an Executive re-sends an invitation by inviting the person again, and is told when the email did not go out.
- **Endpoints:** the auth module serves over HTTP only the link a set-password email opens; every other auth endpoint answers not found over HTTP and is reached by the screens' server actions in-process.
- **Deployment guard:** a hosted runtime refuses to start with a missing variable, a published or short `BETTER_AUTH_SECRET`, a non-https base URL, Cloudflare's Turnstile test keys, or a mailer that would log message bodies; readiness reports both database connections, the key-value store (a write and read back), the configuration and the outbox (down when an event has waited more than five minutes).
- **Mobile:** 15-minute access tokens, rotating refresh tokens in the Android Keystore, per-device revocation, minimum-version gate.
- **Voice:** a 5-minute user-scoped token per session so the worker acts as the speaking user.
- **Realtime:** BOS-signed ES256 JWT (≤ 15 min) registered as a Supabase third-party provider; Realtime-only claims.
- **Connector:** HMAC-SHA256 request signing with per-connector keys and a 5-minute skew window.

## 3. Authorization

### 3.1 Model
Roles are permission templates that Executives can edit; the set of roles is fixed (no custom roles), and an edited role is marked customised so a deploy never undoes the edit, while it still receives permissions added to the catalogue later. A permission is `module.resource.action` with a scope: `own`, `team`, `entity` or `all`. Users hold a role per entity; agents are service principals with fixed permission sets.

### 3.2 Permission catalogue
| Permission | Executive | GM | Sales Lead | CC | LC | Store | Inventory | Project Mgr | Field | Accounts | HR |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `crm.lead.read` | all | entity | team | own | own | own | – | entity | – | entity | – |
| `crm.lead.write` | all | entity | team | own | own | own | – | – | – | – | – |
| `crm.lead.assign` | all | entity | team | – | – | – | – | – | – | – | – |
| `crm.lead.merge` | all | entity | team | – | – | – | – | – | – | – | – |
| `crm.account.read` / `.write` | all | entity | team | own | own | own | entity (read) | entity | own (read) | entity (read) | – |
| `calls.dial` | all | entity | team | own | own | own | – | – | – | – | – |
| `calls.recording.listen` | all | entity | team | – | – | – | – | – | – | – | – |
| `sales.quote.create` / `.send` | all | entity | team | – | own | own | – | – | – | – | – |
| `sales.order.create` / `.confirm` | all | entity | team | – | own | own | – | – | – | – | – |
| `sales.order.cancel` | all | entity | – | – | – | – | – | – | – | – | – |
| `sales.credit.release` | all | – | – | – | – | – | – | – | – | – | – |
| `pricing.read` | all | entity | entity | entity | entity | entity | entity | entity | – | entity | – |
| `pricing.write` | all | – | – | – | – | – | – | – | – | – | – |
| `catalogue.write` | all | entity | – | – | – | – | entity | – | – | – | – |
| `tax.rates.write` | all | – | – | – | – | – | – | – | – | entity | – |
| `inventory.stock.read` | all | entity | – | – | entity | entity | entity | entity | own | entity | – |
| `inventory.stock.move` / `.adjust` | all | – | – | – | – | – | entity | – | own (move) | – | – |
| `inventory.dispatch.write` | all | entity | – | – | – | – | entity | entity | – | – | – |
| `inventory.eway.write` | all | – | – | – | – | – | entity | – | – | entity | – |
| `inventory.warranty.write` | all | – | – | – | – | – | entity | – | – | – | – |
| `procurement.po.write` / `.grn.write` | all | – | – | – | – | – | entity | – | – | – | – |
| `procurement.rate.read` | all | – | – | – | – | – | entity | – | – | entity | – |
| `projects.read` / `.write` | all | entity | – | – | own (read) | – | – | entity | own | entity (read) | – |
| `projects.gate.approve` / `.qc.signoff` | all | entity | – | – | – | – | – | entity | – | – | – |
| `projects.schedule.write` | all | entity | – | – | – | – | – | entity | – | – | – |
| `documents.read` / `.write` | all | entity | – | – | own | own | – | entity | own | entity | – |
| `documents.sensitive.read` | all | – | – | – | – | – | – | entity | – | entity | – |
| `finance.proforma.write` / `.payment.write` / `.recon.write` | all | – | – | – | – | – | – | – | – | entity | – |
| `finance.cost.read` | all | – | – | – | – | – | – | – | – | entity | – |
| `finance.expense.submit` | own | own | own | own | own | own | own | own | own | own | own |
| `finance.expense.approve` | all | entity (manager step) | team | – | – | – | – | entity | – | entity | – |
| `finance.expense.verify` | all | – | – | – | – | – | – | – | – | entity | – |
| `hr.employee.write` / `.attendance.manage` / `.leave.approve` / `.incentive.manage` | all | entity (leave) | team (leave) | – | – | – | – | – | – | – | all |
| `hr.export` | all | – | – | – | – | – | – | – | – | all | all |
| `knowledge.vault.read.staff` | all | all | all | all | all | all | all | all | all | all | all |
| `knowledge.vault.read.management` | all | all | – | – | – | – | – | – | – | all | – |
| `knowledge.vault.read.exec` | all | – | – | – | – | – | – | – | – | – | – |
| `knowledge.playbook.approve` | all | – | – | – | – | – | – | – | – | – | – |
| `agents.inbox.act` | all | entity | team | own | own | own | entity | entity | – | entity | – |
| `agents.autonomy.write` | all | – | – | – | – | – | – | – | – | – | – |
| `agents.killswitch` | all | all | – | – | – | – | – | – | – | – | – |
| `voice.use` | all | all | – | – | – | – | – | – | – | – | – |
| `reports.export` | all | entity | team | – | – | – | entity | entity | – | entity | all |
| `audit.read` | all | entity | – | – | – | – | – | – | – | entity | – |
| `imports.write` | all | entity | – | – | – | – | – | – | – | – | – |
| `profile.write` | own | own | own | own | own | own | own | own | own | own | own |
| `admin.users.write` / `.roles.write` / `.entities.write` / `.integrations.write` / `.flags.write` | all | – | – | – | – | – | – | – | – | – | – |
| `integrations.dlq.replay` | all | – | – | – | – | – | – | – | – | – | – |

"–" means not granted. The matrix is data in `role_permissions`; this table is its seed and its test oracle.

### 3.3 Agent principals
| Principal | Permissions |
|---|---|
| `agent:triage` | `crm.lead.read:entity`, `crm.lead.write:entity` (score, pipeline, entity fields only), `crm.lead.assign:entity`, `crm.lead.merge:entity` (suggest only) |
| `agent:concierge` | Read the current thread's account and opportunity; write qualification fields; book callback and site-visit slots; send approved templates and in-window messages; file documents; hand off. No cross-customer queries, no price edits, no internal notes |
| `agent:copilot` | `crm.lead.read:entity`, write summaries, dispositions and follow-up tasks; read approved knowledge |
| `agent:sizing` | `pricing.read:entity`, `inventory.stock.read:entity`, `sales.quote.create:entity` (draft); no cost permissions |
| `agent:orchestrator` | `projects.read/write:entity`, `projects.schedule.write:entity` (suggest), `documents.write:entity`, message requests |
| `agent:chief` | Read across modules at entity scope for briefings and anomalies; no cost permissions, no writes except Agent Inbox items |

No agent principal holds `procurement.rate.read`, `finance.cost.read`, `documents.sensitive.read`, `knowledge.vault.read.exec`, any admin permission, or the human controls (`agents.inbox.act`, `agents.autonomy.write`, `agents.killswitch`, `knowledge.playbook.approve`, `sales.credit.release`). The Triage and Co-pilot agents work on opportunity data without customer names or phone numbers; they hold no `crm.account.*` permission. Ask the Business and voice Ask run as the user.

### 3.4 Voice principals
A `voice_session` principal (`principals.kind`) stands for one "Talk to Shakti" session (blueprint §9.2, ADR 0010). It is not an agent: it acts as the speaking user.

| Rule | Source |
|---|---|
| Only a user holding `voice.use` (Executive and GM, §3.2) can start a session through `POST /voice/session`; Executives and GMs first | Blueprint §9.2, ADR 0010 |
| The worker calls `/api/v1` with a 5-minute BOS token for the speaking user (`VoiceTokenClaims`, `aud: shakti-voice`, `sid` = the session), so every tool call is a command run with that user's own grants and entity scope, under RLS and cost masking; the worker holds no database credentials and no service role | Blueprint §9.2, ADR 0010 |
| Command mode proposes actions that the user confirms with a tap before they run | Blueprint §9.2 |
| A recording question before every session (`consentRecording`), a visible listening indicator, PII masking before any model call, and per-user daily minute and spend caps checked when the session starts (`voice_cap_reached`) and enforced by the worker during it | Blueprint §9.2, ADR 0010 |
| Proposed: the principal never carries `finance.cost.read` or `procurement.rate.read`, even for an Executive, so a spoken answer never reads out a cost or supplier rate; cost figures stay on the screen reports that run under the viewer's own permissions | Proposed, from the blueprint's cost masking for voice (§9.2) |
| Proposed: each command a session runs is audited with `actor_kind = voice_session` and the speaking user in `on_behalf_of_user_id` | Proposed (`audit_logs`, DATABASE §6.10) |

## 4. Data isolation
- RLS on every business table with fail-closed policies (`docs/DATABASE.md` §4); `FORCE ROW LEVEL SECURITY`; `app_user` is not the owner and has no `BYPASSRLS`.
- Two cost permissions enforced in RLS and in DTOs: `procurement.rate.read` (supplier rates, PO values, purchase vouchers) and `finance.cost.read` (item costs, job costs, margins).
- Cost columns live in side tables (`item_costs`, `stock_movement_costs`, `job_cost_entries`, `tally_purchase_vouchers`) so operational tables carry no cost data.
- Exports are permission-gated commands and audited with the row count and filter.
- Materialised views with margins are readable only through commands that require `finance.cost.read`.

## 5. Data protection (DPDP Act 2023, Rules 2025)
- **Consent:** per channel, purpose and source with evidence; opt-out honoured by humans and agents; consent text versions stored.
- **Rights:** data-principal export and deletion commands, subject to retention obligations; requests logged with due dates.
- **Aadhaar:** never stored. OCR masking at capture keeps only the last four digits and a masked image; the original is deleted. This applies to WhatsApp uploads, field-app photos and web uploads.
- **Bank details:** field-level encryption (AES-256-GCM, keys in KMS) with decryption only in the payment and proforma commands.
- **Masking before LLM calls:** phone numbers, Aadhaar digits, bank details and street addresses replaced by placeholders in text; documents pass through the masking step before vision classification; transcripts are masked before summarisation.
- **Vendors:** data processing terms confirmed with Anthropic, Voyage, the speech vendor and LiveKit, including retention settings; listed in the privacy notice.
- **Retention:** schedule in blueprint §7.9, executed by logged jobs.
- **Breach handling:** `privacy_incidents` register; runbook to contain, assess, notify the Data Protection Board and affected principals in plain language within the Rules' timelines, and record every step.
- **Calendar:** consent notices, rights handling and breach protocol live before 14 May 2027.

## 6. AI security
- Untrusted inputs (customer messages, uploads, transcripts, webhook payloads) are labelled as data in prompts and never concatenated as instructions.
- Concierge tools are the six listed in §3.3; tool inputs are validated with `strict` schemas; every tool call is a domain command with its own permission guard.
- Deterministic output filters on every outbound message: no internal data, no other customer's PII, claims limited to approved Playbook directives, length limit, link allowlist.
- Rate limits per conversation; abuse detection; automatic handoff after repeated failed turns, complaints or legal topics.
- Autonomy levels per agent × action type; promotion to Automatic only after ≥ 95% unedited over ≥ 200 cases with Executive sign-off.
- Kill switches (global, per agent, per entity); per-agent daily spend caps; token budgets per run.
- Prompt-injection test set (data exfiltration, price manipulation, unauthorised promises, tool misuse) runs in CI; every case must fail safely.
- Evals gate every prompt or model change.

## 7. Telecom compliance
- Each entity registered on DLT as a Principal Entity; headers and consent templates registered.
- 140-series numbers for promotional outbound; 160-series for service calls to leads with recorded consent; inbound IVR on standard virtual numbers.
- TRAI hours (9 AM–9 PM) and DND scrubbing enforced in the dial command; recording notice on every call.
- WhatsApp: opt-in and opt-out, 24-hour window, approved templates per number, quality-rating monitoring, portfolio messaging-limit budget with service messages first.

## 8. Application security
- CSP with nonces; CSRF origin checks on server actions; Zod validation on every input; output encoding by React.
- Uploads: pre-signed URLs with type and size limits; malware scan before `ready`; images re-encoded; PDFs sanitised.
- Secrets only in Vercel, EAS and the connector's encrypted local store; none in the repo, `tooling.json` or `.mcp.json`.
- Logging: structured JSON; request IDs; no phone numbers, Aadhaar digits, bank details or message bodies; log redaction tested.
- Supply chain: Dependabot (weekly, grouped; minor and patch bumps merge automatically once CI passes, majors wait for the owner's review), `pnpm audit --audit-level=moderate` and a gitleaks secret scan over the history in CI; CodeQL once the repository has GitHub Advanced Security; pinned lockfile; provenance-checked releases for the connector.
- Staging holds synthetic data only.

## 9. Infrastructure security
- Supabase: network restrictions to Vercel and workers; SSL enforced; PITR; audit of dashboard access.
- Vercel: environment separation, protected production branch, deployment protection on previews.
- AWS: one least-privilege IAM user per environment for S3 and SES; KMS key per environment with rotation; S3 block public access; lifecycle rules; backup bucket in a separate account or with object lock.
- Upstash: separate databases per environment; signing keys rotated.
- LiveKit: room tokens with 5-minute TTL; worker credentials per environment.
- Client PC (connector): encrypted config, least-privilege Windows service account, signed self-updates.

## 10. Operations
- **Secret rotation:** every 6 months and on offboarding. `BETTER_AUTH_SECRET` also encrypts the stored authenticator secrets, so it is never replaced outright: the new key goes first in `BETTER_AUTH_SECRETS` (`<version>:<secret>` entries) and the previous `BETTER_AUTH_SECRET` stays set as the legacy key until every enrolled user has re-enrolled or the data is re-encrypted.
- **Offboarding:** revoke sessions, rotate shared keys, remove from GitHub, Vercel, Supabase, AWS, Meta, Exotel, Anthropic within one business day.
- **Incident response:** severity levels, on-call contact, containment steps, communication template, post-incident review within 5 working days.
- **Pentest:** external test before go-live (Phase 7) and annually; findings tracked to closure.
- **Restore drills:** quarterly.
- **Access review:** quarterly review of roles and agent autonomy settings by an Executive.

## 11. Security test suite
Runs on every PR against real Postgres:
1. For every business table and every role × entity pair: only that entity's rows are visible; no context ⇒ zero rows.
2. Cost fields absent from every DTO unless the command requires a cost permission; GM sees no rates and no margins; Inventory Manager sees rates and no margins; purchase vouchers gated.
3. Agent principals cannot call cost, admin or sensitive-document commands.
4. Voice tokens act only as the issuing user and expire.
5. Realtime JWTs for user A cannot subscribe to user B's or another entity's channels.
6. Vector retrieval respects sensitivity per role.
7. WhatsApp documents file only against the sending customer.
8. Masking: Aadhaar digits never appear in storage, logs or LLM payloads (assertion on captured requests).
9. Webhooks: invalid signatures rejected; duplicates ignored.
10. Dial command: blocked outside TRAI hours, for DND without consent, and on the wrong number series.
