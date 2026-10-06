# N1 Notifications (wave 4)

| | |
|---|---|
| Branch | `feat/n1-notifications` on GitHub, from `main` at f74caff0 (#121) |
| PC worktree | none: the PC runs no Docker (owner, 05-10-2026) |
| Runs on | Cloud: build, review, fixes, the merge with `main`, integration and baselines; the pull request and the hosted steps from the PC |
| State | brief |
| Next step | a cloud builder builds the slice from this brief |

## Brief
Read first:
- Design: [`docs/design/phase1.md` §8.1](../../design/phase1.md#81-n1-notifications), §2 (poll every 15 seconds before Realtime), §3 (N1 needs AI0 and T1; T2 needs N1) and §12; §7.1 "Built (AI0)" (the inbox), §7.2 "Built (T1)" (callbacks, `rankedQueue()`'s late first calls), §7.3 "Built (S1)" and §7.4 "Built (D1)"
- PRD RPT-04 (both acceptance criteria; FCM is Phase 4); BLUEPRINT §8.11; ARCHITECTURE (the notify worker, polling); API §3.6 (`POST /workers/notify`, `NotifyJob` and `NotifyResult` already in `packages/contracts/src/api/worker-jobs.ts` and `endpoints.ts`); DATABASE's planned `notifications`; DESIGN.md (the 48 px top bar) and §11; DECISIONS 29-09-2026 (polling)
- How events reach workers: `apps/web/src/workers/outbox.ts`, `qstash.ts` (`EVENT_JOB_ROUTES`, the paths), `events/deliver.ts`, `events/registry.ts` (`EVENT_WORKERS`; a test ties `subscribed: true` in the catalogue to it), `events/system-principal.ts`, `company-batches.ts`, `nightly-route.ts`, `apps/web/scripts/qstash-schedule.ts`, DEPLOY step 6
- `SYSTEM_MATRIX`, `PLATFORM_ONLY_PERMISSIONS` and the latest `app.platform_only_permissions()` (D1's migration); `inbox_items` and its insert policy (AI0's RLS migration: agents' suggestions only, "routed work arrives with the slice that routes it"); `heldByColleague()` in `create-lead.ts`
- The top bar: `InboxLink` in `apps/web/src/components/shell/app-shell.tsx`, `inboxCount()` and its cache; `web-push` is already a dependency of `apps/web` (nothing imports it yet)
- Skills: `add-command`, `add-table`, `vercel-react-best-practices`, `web-design-guidelines`, `writing-guidelines`.

1. **Tables**, each with RLS (a person reads and changes only their own rows), fixture rows, matrix rules, `app_reader` where a query reads them, the testing lists, `NARROWER` and `enum-sync` where they apply (AGENTS §6):
   - `notifications`: `user_id`, `entity_id`, `type`, `subject_type`, `subject_id`, `payload_json` (ids and catalogue values only, never a phone number or free text a model wrote), `dedupe_key` (unique per user, so a repeated delivery or scan makes one notice), `created_at`, `read_at`, `channel_sent_json`. Written only by the notify worker through a narrow definer; a person marks their own as read.
   - `notification_preferences`: `user_id`, `type`, `in_app`, `push`; `quiet_from` and `quiet_to` (IST times) on a per-user row. Defaults when a person has set nothing: in-app and push on, no quiet hours (the lead's decision; nothing is invented about the client's hours).
   - `push_subscriptions`: `user_id`, `endpoint` (unique), the two keys, `user_agent`, `created_at`, `last_ok_at`; a subscription the push service answers 404 or 410 for is removed.
2. **Permissions:** a person needs none to read their own notices. The worker runs as `system:workers` with a new platform-only `notifications.send` (and the scan below with it), in `SYSTEM_MATRIX`, `PLATFORM_ONLY_PERMISSIONS` and a new definition of `app.platform_only_permissions()` that keeps every key `main` has. Check it against `main`'s latest definition at the merge (slice-integration §10).
3. **The notify worker** (`/api/v1/workers/notify`, `NotifyJob`, routed through `EVENT_JOB_ROUTES` with the in-process fallback): each notice type has a catalogue sentence in `en.json`, a link to the screen the person acts on, and the person who acts on it (PRD RPT-04 criterion 1). Pushes respect preferences and quiet hours (`heldForQuietHours`; held pushes are not sent later, the notice waits in the centre).
   - `crm.opportunity.assigned`: the new owner (not when they assigned it to themselves).
   - `crm.duplicate.found`: the owners of the two leads or customers' leads, in the card's company.
   - A callback or nurture call falling due, and a quote one day before it lapses (`valid_until`; the one day is a named constant, the lead's decision): there is no event for either, so a scan finds them (below).
   - A first-contact SLA breach (the pipeline's `first_contact_sla_minutes`, null until the sales head sets one, so no breach until then; the same test as `rankedQueue()`'s late first call): the company's GM, once per lead (PRD RPT-04 criterion 2).
   - An order held for credit: S2 sends `sales.order.credit_held`; whichever of N1 and S2 merges second wires it (integration notes).
   - Each type's event flips to `subscribed: true` in the catalogue with its worker in `EVENT_WORKERS`.
4. **The scan:** `/api/v1/workers/notifications/scan`, on `runCompanyBatches()` and `nightlyWorkerRoute()` as `system:workers`, reaching tasks, quotes, leads and calls only through narrow definers that check the platform-only permission and return ids; it calls the notify path with a `dedupe_key` per task, quote and lead. A QStash schedule `notification-scan-<environment>` every 5 minutes (`qstash-schedule.ts`, DEPLOY step 6); `EXPLAIN (ANALYZE)` of each definer's query at a realistic size.
5. **A lead refused as `customer_held_by_colleague`** becomes routed work for that colleague (RPT-04 criterion 2): the refusal rolls its transaction back, so the server action, on that refusal, runs a new people-only command `crm.enquiry.route` in a fresh transaction. It records an `inbox_items` row of kind `routed_work` on the customer for the colleague who looks after it, with the enquiry's segment and note, and sends the notice. It needs `crm.lead.create` over the company. The insert policy on `inbox_items` gains routed work by a person under that rule. The lead and walk-in forms then say in plain words that the enquiry went to the colleague, by name. An import row still stays refused, as today.
6. **Browser push:** VAPID keys from `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`, optional: without them push is off and the centre still works. They go in `turbo.json`, `.env.example` and DEPLOY step 11, never in the hosted start check's required list. Sending uses `web-push` behind a small sender interface with a fake for tests. The service worker is a static file the proxy and the CSP allow, and shows the notice's sentence and opens its link. Subscribing happens from the centre, by a person's tap, never on page load.
7. **Screens:** the bell beside `InboxLink` with the unread count (polled every 15 seconds while the tab is visible, as AI0's count is cached). The centre is a panel listing notices newest first, keyset, with mark read and mark all read; `EXPLAIN` under RLS. Settings › Notifications holds per-type in-app and push switches, quiet hours, and turning push on or off for this browser. Journeys with axe, copy in `en.json`, the JavaScript budget (the bell is on every staff page: measure the shell's growth).
8. **Tests:** each type reaches the right person and only them; a person cannot read another's notice; dedupe on a repeated delivery and on a repeated scan; quiet hours hold a push; a 410 removes the subscription; the routed enquiry reaches the colleague's inbox and not the caller's; the SLA breach reaches the GM once. A journey assigns a lead to a caller, who sees the bell's count and opens the lead from the centre; a duplicate notice; the settings page.
9. **Documents:** DATABASE (the three tables), SECURITY (§3.3 the worker's grant; notices are a person's own), API (the notify and scan routes), ARCHITECTURE (the notify worker now exists), DEPLOY (the schedule, the VAPID variables), design §8.1 "Built (N1)", `pnpm db:docs`, `machines:docs` if a machine changes.

Done when: the checks of AGENTS §10 pass on the branch; the cases of item 8 pass on real Postgres; a journey shows an assignment notice reaching its person and opening the lead.

Not in N1: Realtime (after its spike on the production domain; switching changes no table); FCM (Phase 4); the handover (T2, which uses this slice's notify path); any notice for orders beyond `sales.order.credit_held`. Files another slice owns: S2 orders and credit, K1 the vault.

## Report

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
1. If S2 merged first: subscribe the notify worker to `sales.order.credit_held` (the Executive of the order's company and the order's maker), with its notice type, preference and a journey line.
2. The owner creates the QStash schedule `notification-scan-<environment>` on dev and staging from the values the lead gives, and the VAPID keys go on Vercel through a script the lead writes (a secret, so the owner runs it).
