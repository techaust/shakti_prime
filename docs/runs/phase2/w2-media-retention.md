# W2 WhatsApp media retention (wave 4)

| | |
|---|---|
| Branch | `feat/w2-media-retention` on GitHub, from `main` at 889ec54d |
| Runs on | a cloud session of its own; the lead on the PC reviews and integrates (owner, 20-11-2026, for this day) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): deletes customers' files |
| Usage | 5-hour window 0 % at 05:45 UTC when briefed; builder on Opus 5.5 at high effort (start) |
| State | early check |
| Next step | the lead reads the early check; "continue" for steps 3 to 5 |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase2.md` §11](../../03-roadmap-appendix/phase2.md#11-workshop-defaults) (`retention`: WhatsApp media three years, then a text summary, for the CA to confirm) and §6.1; BLUEPRINT §7.9; DATABASE §10 if it lists retention jobs; ADR 0020 (the workers principal holds platform-only permissions and works through narrow definers).
- [w1-whatsapp.md](w1-whatsapp.md): Built item 15 (the job not built; `WORKSHOP_DEFAULTS.retention.whatsappMediaYears`), decisions 15 and 22 (the anonymisation leaves a customer's WhatsApp files to this job), and the note that a process stopped between a try's store and its attach leaves an original under a key no file row names.
- What exists: `packages/domain/src/workshop-defaults.ts` (`retention`), `packages/db/src/schema/retention-runs.ts`, `whatsapp.ts`, `files.ts`; the existing removal jobs to follow (`apps/web/src/workers/lead-anonymise.ts`, the files sweep, P5's `app.webhook_purge()`), the files layer `apps/web/src/files` and its storage port, the nightly route `apps/web/src/workers/nightly-route.ts` and `schedules.ts`; `infra/aws/files.yaml` (whether the worker's role may delete objects under the WhatsApp prefix).

Build, in this order:
1. **The removal** as a narrow definer only the workers principal may call (a new platform-only permission, e.g. `messaging.media.expire`, held by `system:workers` alone): WhatsApp media whose message arrived more than `retention.whatsappMediaYears` ago lose their file (the file row marked removed, the object deleted through the files layer's port), while the message keeps its text, its caption and a short text summary of what was sent (type, file name, size, the checks' verdict). In batches by a keyset cursor, each batch recorded in `retention_runs`; a dry run that counts without removing. A file another record still uses (filed against a lead, a customer document) is kept; say how you detect that.
2. **Orphan originals:** keys under the WhatsApp prefix that no file row names and that are older than a day are removed in the same run.

**Early check (Tier A):** once steps 1 and 2 are committed with their tests (security suite: only the workers principal may call the definer, a person's role never holds the permission, the agent refusal sweep refuses it; on real Postgres: a message older than the period loses its file and keeps its text and summary, a newer one is untouched, a file still used elsewhere is kept, the dry run removes nothing, batches resume from the cursor; the storage port faked), write a short report here, push `report: w2-media-retention early check` and stop. The lead reads the diff and sends "continue" to this session.

3. **Running it:** from the existing nightly route (no new QStash schedule; a new one is an owner's step on every hosted environment), behind the kill or enable setting the other retention jobs use, reported to the jobs check like them (`job.failing` on repeated failure).
4. **The thread:** a message whose file was removed shows its summary and "This file was removed after three years" (or the wording the catalogue's existing retention notices use), never a broken link; copy in `en.json`, the thread journey and its baselines if the thread changed.
5. **Documents:** DATABASE's retention list, SECURITY if it lists retention, the design's "Built (W2)" line under §11, and in your report whether `infra/aws/files.yaml` lets the worker delete under the WhatsApp prefix (if not, the change set the owner applies, exactly; do not edit hosted stacks).

Files owned: the definer and its migration, the job under `apps/web/src/workers/`, its line in the nightly route and the jobs check, the thread's removed-file line in `apps/web/src/screens/messaging/`.

Do not touch: `apps/web/src/workers/messaging/` notice logic (`p2-fixes`), `apps/web/src/observability/` (`g2-alerts`), `docs/runbooks/` (`g2-runbooks`), the agents' reports (`g2-shadow-pack`).

Review checklist (check before your report): nothing newer than the period is touched; text and summary survive; a file used elsewhere survives; only the workers principal can remove; a dry run changes nothing; every batch is recorded; no customer's details in logs or alerts.

## How this slice runs
- **Your role:** you are this slice's builder, not the lead. Read `.claude/agents/slice-builder.md` first and follow it as your rules (its **Cloud** lines), with this file as your brief. `CLAUDE.md` calls every session the lead: in this session that does not apply. Do not run the `start-session` or `end-session` skills, open or merge a pull request, push to `main`, touch any hosted service or GitHub workflow, delete a branch, or force-push.
- **Branch:** `feat/w2-media-retention` is on GitHub with this file. Start with `git fetch origin && git switch feat/w2-media-retention` and work in the checkout itself (one slice in this VM); the session hook starts Postgres on 54322 (start every shell command with `. tools/integration/lib.sh &&`).
- **Push:** commit as you go and push your branch after every commit, at least every 10 minutes; a reclaimed VM loses everything unpushed.
- **Your checks, in the VM, before each report:** `pnpm typecheck`; `pnpm exec eslint --max-warnings 0 <each folder you touched>`; the unit tests of each package you touched; `pnpm test:security` when you touched schema, policies, definers, commands or queries; `pnpm copy-lint` when you touched `en.json`; `pnpm db:docs` and `pnpm --filter @shakti/domain machines:docs` when they apply; then `pnpm build` and your own journeys (`pnpm --filter web e2e:seed && pnpm --filter web exec playwright test <your specs>`), and your screens' Linux baselines with `pnpm --filter web e2e:snap -- <your specs>`. Run a long command in the background (each has 30 minutes), the build and the journeys as separate commands. The whole-repository `pnpm lint` once, as your final check.
- **Reporting:** the lead watches your branch from the owner's PC and reads nothing else of this session. Write each report into this file's Report section (under a heading with the date and "cloud session"), commit it with the subject `report: w2-media-retention <stage>` and push. The stages are `early check`, `done`, `fixes` and `blocked`. That commit subject is how the lead knows you have stopped. After `report: w2-media-retention done` stop: the lead reviews the branch and may send the review's findings to this session for one fix round, which ends with `report: w2-media-retention fixes`.
- **Questions:** the owner does not read this session. For a minor gap take the reasonable call, record it under "Assumptions" in your report and continue. Only when no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: w2-media-retention blocked` with the question and stop.
- **Migrations:** number yours after `main`'s last (0218); the lead renumbers them at the merge. Never cite a migration number in code.
- **Never:** a live model, vendor or hosted call in a test; a `package.json` script change, a new package or a lockfile edit unless this brief names it; an edit to a file another slice owns (listed below).
- **Usage line:** record your model and effort at the start and end in the header's Usage line (the owner runs this session on Opus 5.5 at high).

**Built beside you today, each in its own cloud session from `main` at 889ec54d:** `g2-shadow-pack` (the Concierge and Co-pilot shadow reports and review samples), `g2-alerts` (Phase 2 alerts), `g2-runbooks` (INCIDENTS sections and the exit-gate checklist; documents only), `g2-measures` (the latency and throughput measures), `p2-fixes` (Phase 2 review follow-ups) and `w2-media-retention` (the WhatsApp media retention job). Shared registration points (`en.json`, `AGENT_DEFAULTS`, `WORKSHOP_DEFAULTS`, the permission catalogue and seed, the event worker registry, the testing lists, `turbo.json`, `.env.example`, the jobs check's list) take one line or one block each, kept together under a comment naming your slice; the lead merges them.

## Report

### 20-11-2026, cloud session: early check
Model and effort: Opus 5.5, high (start). Skills loaded: `add-command`.

**Built (steps 1 and 2):**
- Schema (`packages/db/src/schema/whatsapp.ts`, migration `0219_w2_media_retention.sql`, generated): `whatsapp_messages.media_summary` (jsonb), its check (only a media message with a file, an object, at most 1,000 bytes), and the partial keyset index `whatsapp_messages_media_kept_idx (entity_id, created_at, id) where kind = 'media' and file_id is not null and media_summary is null`, so a message leaves the job's window once its file is removed. The generated check named the table in its columns, which a partitioned table's partitions refuse; the SQL is unqualified by hand.
- Custom migration `0220_w2_media_retention_rls.sql`: `app.platform_only_permissions()` with 0201's eighteen keys kept and `messaging.media.expire`; the trigger `whatsapp_messages_media_summary_guard` (its own function, so `app.whatsapp_messages_guard()` stays as 0188 made it): no message is written with a summary, a summary once written never changes; `app.whatsapp_media_files_in_use()` and `app.require_media_expire()` (helpers, no role may run them); the four definers granted to `app_user`, each checking `messaging.media.expire:entity` and the request's company: `app.whatsapp_media_due()` (the batch read), `app.whatsapp_expire_media()` (the removal record), `app.whatsapp_media_keys_kept()` (the orphans' lookup), `app.whatsapp_media_orphans_record()`.
- Permission `messaging.media.expire`: platform-only, held by `system:workers` alone (contracts `PERMISSION_KEYS`, `PLATFORM_ONLY_PERMISSIONS`, scopes; `SYSTEM_MATRIX`; the seeds; the role editor's label in `en.json`; SECURITY §3.2 holder list, matrix row and description row).
- Contracts `packages/contracts/src/commands/messaging/media-retention.ts`; domain commands `messaging.media.expire` and `messaging.media.record_orphans` (`packages/domain/src/commands/messaging/media-retention.ts`, registry, Activity log labels in `audit.ts` and `en.json`), reads `dueWhatsAppMedia` and `whatsAppMediaKeysKept` (`packages/domain/src/queries/messaging/media-retention.ts`).
- The files layer's port gains `list(prefix, { after, limit })` (`packages/domain/src/ports/file-store.ts`: memory and local disk stores; `apps/web/src/files/s3-store.ts`: by `ListObjectVersions`, which the app's IAM user already may run as `s3:ListBucketVersions`, and which also finds a key whose current object was removed while an older version stayed).
- The job `apps/web/src/workers/whatsapp-media-retention.ts` (`runWhatsAppMediaRetention`), not yet called by any route (step 3).

**How it works:**
- Per company, as `systemWorkersPrincipal(company)`: batches of 200 by the cursor `(created_at, id)`, the time answered as text to the microsecond. For each due file no other record uses, every key of the file is deleted from the store (its bytes, the upload's own key when the checks replaced it with a masked copy, `scan_result.originalKey`, and a PDF's `-checked/` pages folder), then one `messaging.media.expire` records the batch: under lock the definer checks each message again (older than the period, a media message of the company with no summary, a `whatsapp_media` file not in use), marks the file `deleted_at` (row kept), writes the summary `{contentType, name, size, verdict: passed | refused | unchecked, removedAt}` and inserts one `retention_runs` row (`whatsapp-media-expire`, rows removed, and `the store refused N files` as the error). A file the store refuses is never recorded removed while its bytes remain; it waits for the next run. The message keeps `body_masked` (its caption) and `file_id`.
- **A file used elsewhere** is detected in `app.whatsapp_media_files_in_use()`: every foreign key in the catalogue that references `files(id)` (`pg_constraint`, skipping partitions' copies), read at run time, so a table added later that files a WhatsApp photo against a lead or a customer document is covered with no change; plus another WhatsApp message still within the period naming the same file. Today the keys are `consents.evidence_file_id`, `import_jobs`, `knowledge_files`, `provider_calls` (2), `quotes` (2) and `voice_sessions` (2). A quote's PDF sent on WhatsApp is never a candidate: its message is a `template` and its file a `quote_pdf`.
- **Orphans:** for each company, the keys under `<company>/whatsapp_media/` made in the last 30 days (a key starts with its file's UUIDv7 id, so the listing starts at the id of 30 days ago and stops at the first key made within the day, never reading three years of photos) and stored more than a day ago, that `app.whatsapp_media_keys_kept()` does not keep (kept: a key a file row not deleted names; every key of a file still in its checks: upload, copy being written, masked pages), are deleted; each company's sweep is one `retention_runs` row (`whatsapp-media-orphans`).
- **Dry run:** reads only; no store call but listing, no command, no `retention_runs` row.
- **Time budget:** the job answers `next` (`{ entityId, step: 'expire', after }` or `{ entityId, step: 'orphans', afterKey, startedAt }`) when its budget is spent, for the next call to start from.

**Tests added:**
- `packages/db/tests/security/whatsapp-media-retention.test.ts`: 9 (platform-only and held by `system:workers` alone; every definer refused to an Executive, a GM, the lead's owner and the Concierge, and to the workers of another company; the helpers not executable by any request role; an old file removed with text and summary kept and a newer one named in the same call untouched; a file used by a newer message or by a consent's evidence kept; the keyset reads each message once in order with batches of one; the summary guard; the orphans' lookup; the sweep's record).
- `packages/domain/tests/commands/whatsapp-media-retention.test.ts`: 5 (denied to a person, the lead's owner, the Concierge and another company's workers; the happy path with its audit row; the cursor's batches change nothing; a listed key with quotes and commas cannot change the statement; the orphans' record, denied and wrong-company).
- `apps/web/tests/whatsapp-media-retention.test.ts`: 6, the job against the memory store (a dry run changes nothing, then old files go with the original and masked pages and newer ones stay; a file in use stays; a store refusal is not recorded removed, is the batch's error, logs ids only, and the next run removes it; a run out of time answers its place and the next resumes from the cursor; orphans more than a day old in the window go, a young one, one beyond the window and a named one stay; no store removes nothing).
- `packages/domain/tests/security/agent-refusals.test.ts`: both commands in the platform-work sweep (every agent refused at the guard).
- Unit: `file-store.test.ts` +2 (memory and disk listing), `s3-store.test.ts` +2 (versions grouped per key, paging, a prefix that is not a folder).

**Checks in this VM:** CHECKS_PLACEHOLDER

**`EXPLAIN (ANALYZE)`** of the due read (local data, 104 messages; with `enable_seqscan = off`, since the planner reads so few rows by a sequential scan): `Bitmap Index Scan on whatsapp_messages_default_entity_id_created_at_id_idx` (the partition's copy of `whatsapp_messages_media_kept_idx`), `Index Cond: entity_id = 1 AND created_at < now() - 3 years AND ROW(created_at, id) > ROW(cursor)`, the partial predicate matched, 4 of 5 partitions pruned; files by `files_entity_purpose_created_idx`; 0.32 ms.

**`infra/aws/files.yaml`:** no change needed. The app user's `FileObjects` statement allows `s3:DeleteObject` and `s3:DeleteObjectVersion` on `${FilesBucket.Arn}/*`, which covers `<company>/whatsapp_media/`, and `FileVersions` allows `s3:ListBucketVersions` on the bucket, which the new `list` uses (`ListObjectVersions` with a prefix); `s3:ListBucket` is not needed.

**Assumptions and decisions:**
1. The summary is a jsonb column on the message, written once by the definer and guarded by a trigger of its own, not a new table; the file's row is kept too (marked deleted), so the trail holds both.
2. The period is enforced in the database: both definers compute the cutoff from their own `now()` and the years the command passes from `WORKSHOP_DEFAULTS` (bounded 1 to 10), never from a time the caller gives.
3. Store first, then the record, as the call recordings' sweep does. The window between the read and the record (milliseconds) leaves one narrow race: a file filed elsewhere in that window loses its bytes and keeps its row; the job logs `messaging.media_retention_in_use_after_delete`. No path files a WhatsApp file elsewhere today (`whatsapp_media` has `write: null`); a later one should copy the file rather than point at it.
4. Two old messages naming one file both lose it (the newer-message rule counts only messages still within the period), so such a file cannot be kept for ever by its own expired twin.
5. Orphans: 30 days' window and a day's minimum age (`ORPHAN_LOOKBACK_DAYS`, `ORPHAN_MIN_AGE_HOURS`); W1 merged in November, so the first run covers every key W1 could have left. A key whose current object was removed but whose older version remains is listed and removed with every version.
6. An archived company is still swept (retention applies to its customers' files too), unlike the leads' anonymisation, which passes archived companies by.
7. A file in another store than the run's (`bucket`) is counted (`otherStore`) and left, as the recordings' sweep does.
8. `FileStore.list` is a new required member of the port; the one hand-made store in tests (`apps/web/src/print/documents.test.ts`) gains a one-line stub.

**For the lead:** the migration redefines `app.platform_only_permissions()`; any other wave-4 slice that adds a platform-only key redefines it too, so the merge keeps both lists' keys (and SECURITY §3.2's holder list).

**Next (after "continue"):** step 3 (the nightly route, the kill or enable setting, the jobs check), step 4 (the thread's removed-file line, copy, journey and baselines), step 5 (DATABASE, SECURITY's retention list if any, the design's "Built (W2)").

## Review

## Integration
