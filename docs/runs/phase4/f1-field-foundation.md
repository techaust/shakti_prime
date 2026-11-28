# F1 Field app foundation and mobile sign-in (Phase 4, wave 1)

| | |
|---|---|
| Branch | `feat/f1-field-foundation` on GitHub, from `main` after the approved design (#295), with the lead's commit adding `apps/field/package.json` and the lockfile |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): authentication, tokens, device revocation |
| Usage | briefed 27-11-2026; built by the slice builder on Opus 5.5 at high effort (27-11-2026, early check and done; the fix rounds 1 and 2, 27-11-2026, Opus 5.5 at high) |
| State | prepped for integration (main `bdf82df4` taken in, every `integrate.sh` part but e2e passed on 54340) |
| Next step | the lead reads the second round's diff (`5fd64d1f..`), then integration on a fresh database (the journey and the Linux baselines of `field-phones.spec.ts`) |

## Brief
Build [phase4 §6.4](../../03-roadmap-appendix/phase4.md#64-f1-field-app-foundation-and-mobile-sign-in) as written, with question 7 (a): ADR 0012 accepted. Change its status line to "Accepted (27-11-2026, Phase 4 design)", with one correction if you find one (WatermelonDB uses its own SQLite adapter, not expo-sqlite: say which the app uses). Follow [AGENTS §5](../../../AGENTS.md#5-domain-commands) and [AGENTS §6](../../../AGENTS.md#6-database-changes). Points the design leaves to you, settled here:

1. **Packages:**
   - The lead installed the approved list (question 12) at exact versions at least two weeks old. They are in `apps/field/package.json`, in the lockfile, and in one override in `pnpm-workspace.yaml` for WatermelonDB's old `@babel/runtime`.
   - Use only these. If one more package is needed (a Babel plugin, a config plugin), push `report: f1-field-foundation blocked` naming it, its exact version and why, and stop.
   - The workspace scripts are `start`, `typecheck` and `test` (jest with `jest-expo`). Do not change them; ask in the report if one must change.
2. **The app's skeleton:**
   - `app.json` or `app.config.ts`: the Android package `com.shaktiprime.field`, the development build profile in `eas.json` (with no account id: the owner adds it in the final phase).
   - `tsconfig.json` extending the repository's strict settings.
   - `babel.config.js` with the decorators plugin for WatermelonDB.
   - NativeWind's `tailwind.config.js` reading colours and spacing from `@shakti/tokens` (no hard-coded colour), with light and dark from the system.
   - expo-router screens: Sign in, Unlock (PIN or biometric), Today (empty state in final copy), Settings (sign out, version).
   - A copy catalogue `apps/field/messages/en.json`, which `tools/copy-lint` reads too. Its config is a checks file: name the change in the report for the lead.
3. **The native build check:** a CI job (a checks change: the owner's `checks-ok`) that runs only when `apps/field/**` or the lockfile changes. On `ubuntu-latest` it runs `expo prebuild --platform android --no-install` and `./gradlew assembleDebug`, and uploads the unsigned debug APK as an artifact kept 7 days.
   - Write it in `.github/workflows/ci.yml` beside the other jobs, not as a required check.
   - You cannot run Gradle in the seat's VM. Write the job, and prove the parts you can: prebuild's config generation, typecheck, and jest.
   - The lead reads the first CI run. If WatermelonDB's native module fails to compile with React Native 0.88, that is the owner's decision (ADR 0012), so the lead reports it.
4. **Mobile sign-in** (`/api/v1/auth/mobile/token`, `/refresh` and `/revoke`, per `packages/contracts/src/api/mobile-auth.ts`):
   - Reuse Better Auth's password and TOTP verification through the auth instance (`apps/web/src/auth`). Never a second password path.
   - Access tokens are ES256 JWTs for 15 minutes, signed with a new key pair kept in the environment (`MOBILE_JWT_PRIVATE_KEY` and `MOBILE_JWT_PUBLIC_KEY`, listed in `.env.example` with a generator note, in `turbo.json`, and in `productionConfigProblems()`).
   - Refresh tokens are random, kept only as a hash in `mobile_devices` with their family. They rotate on use. Reuse revokes the family (`refresh_reused`).
   - A revoked device answers `device_revoked`.
   - Rate limits run through the existing Redis limiter, per address and per account.
   - The request context for a mobile bearer is built the same way as a session's (`withRequestContext()`), so row security applies unchanged.
5. **`GET /api/v1/me`:** the person, their roles and companies, `minimumAppVersion` (from `WORKSHOP_DEFAULTS.field` and overridable by a flag), and the flags.
   - `feature_flags` is a table: key, on or off, an optional company. It is written by `admin.flags.write` through a command and read by `/me` and the server.
   - Every mobile route refuses a lower `X-App-Version` with `app_update_required`.
6. **Idempotency front:** mobile mutations carry `Idempotency-Key`. A Redis check (the existing Upstash client, the in-memory store locally and in CI) answers a replay fast in front of the `idempotency_keys` table, which stays the authority (the open follow-up "Mobile tokens and the Redis front").
7. **Web:** Admin › Team members › a person's phones, listing devices with their last use and Revoke (`field.device.revoke`, a new permission per phase4 §4, with its seed and oracle). Journey: an Executive revokes a phone. With axe and snapshots.
8. **App tests (`jest-expo`):** the sign-in and unlock screens, the token store on `expo-secure-store` (mocked), and the version gate's screen.

**Early check (Tier A):** once `mobile_devices`, `feature_flags`, the three auth routes, `/me`, the version gate, the idempotency front and their tests are committed, write a short report with the token design and push `report: f1-field-foundation early check`, then stop. The tests to commit first: rotation, reuse, revocation, expiry, rate limit, no token in a log or a Sentry event, and row security under a mobile bearer equal to a session's.

Files owned: `apps/field/**` (except `package.json`'s dependencies, which are the lead's); `apps/web/src/app/api/v1/auth/mobile/`, `/me`; `apps/web/src/auth/mobile*`; `mobile_devices` and `feature_flags` and their migrations; the phones section of Team members; the CI job; ADR 0012's status.

Do not touch: the sync routes (F2); projects (J1).

Review checklist: no token or secret in logs, Sentry, the URL or the app's plain storage; refresh rotation correct under concurrent refreshes; the version gate on every mobile route; the mobile bearer's context identical to a session's.

## How this slice runs
- **Your role:** you are this slice's builder (or, in a review lane, its reviewer), not the lead. Read `.claude/agents/slice-builder.md` (or `slice-reviewer.md`) and follow it as your rules, with this file as your brief and [the Phase 4 design](../../03-roadmap-appendix/phase4.md) (§1, §3, §4, §5, §10, §13, §14 and your slice's section) as its source. `CLAUDE.md` calls every session the lead; that does not apply to you. Never run the `start-session` or `end-session` skills, open or merge a pull request, push to `main` or `ops/seats`, touch a hosted service or GitHub workflow, delete a branch, force-push, or install a package.
- **Where:** a seat of the seven-day push (seats protocol v2, `seats/readme.md` on `ops/seats`). Your seat gives you a worktree of this branch with its own Postgres and app port, and its lane prompt names them. Work only there. Put every heavy command through `bash tools/integration/heavy.sh`, and also every lint, typecheck and test while another agent runs in the VM.
- **Push:** commit as you go, at least every 20 minutes. Push your branch after every commit (`git push origin HEAD`), at least every 10 minutes.
- **Your checks before each report:**
  - `pnpm typecheck`;
  - `pnpm exec eslint --max-warnings 0 <each folder you touched>`;
  - the unit tests of each package you touched;
  - `pnpm test:security` when you touched schema, policies, definers, commands or queries;
  - `pnpm copy-lint` when you touched `en.json`;
  - `pnpm db:docs` and `pnpm --filter @shakti/domain machines:docs` when they apply;
  - `pnpm build` and `pnpm --filter web js-budget`.

  Journeys cannot sign in on a seat. Write your journeys and run them up to the sign-in, then say in the report which were not run. The lead runs them and makes the Linux baselines at integration.
- **Reporting:** write each report into this file's Report section, under a heading with the date and "seat <n>". Commit it with the subject `report: f1-field-foundation <stage>` and push. The stages are `early check`, `done`, `fixes` and `blocked`. The lead reads only the branch.
- **Questions:** nobody answers in the session. For a minor gap, take the reasonable call, record it under "Assumptions" and continue. When no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: f1-field-foundation blocked` with the question and stop.
- **Migrations:** number yours after `main`'s last (0239 on 27-11-2026). The lead renumbers them at the merge. Never cite a migration number in code.
- **Never:** a live vendor or hosted call in a test; a `package.json` script change, a new package or a lockfile edit; an edit to a file another slice owns.
- **Usage line:** record your model and effort at the start and end in the header's Usage line (Opus 5.5 at high, on the seat's own account).

**Built beside you (Phase 4 wave 1, from 27-11-2026):**
- `j1-projects`: projects, the standard flow, templates and the project page frame;
- `j2-loans`: customer loans;
- `j3-documents`: customer documents, requirements and masking;
- `f1-field-foundation`: `apps/field`, mobile sign-in, `/me` and feature flags.

Phase 3's wave 2 runs at the same time: X4, H2, U2, H3, Q1 and R3.

Shared registration points take one line or one block each, kept together under a comment naming your slice; the lead merges them. They are `en.json`, `WORKSHOP_DEFAULTS`, the permission catalogue and seed, the event catalogue and worker registry, `MACHINES_IN_USE`, the file purposes, the print registry, the testing lists and the retention list, `nav.ts`, `turbo.json` and `.env.example`.

## Report

### 27-11-2026, cloud worktree of the lead's VM: early check
**Token design.**
- **Sign-in** (`POST /api/v1/auth/mobile/token`): the password, the sign-in lock, the per-address cap, the authenticator code or a backup code and the audit rows are the website's, through the app's one Better Auth instance (`signInEmail`, then `verifyTOTP` or `verifyBackupCode` with the pending two-factor cookie, in process). Only the bot check is skipped, and only for calls our own route marks (`signInFromFieldApp()`, an `AsyncLocalStorage` no client can set). The website session Better Auth makes on the way is deleted at once. A role that needs an authenticator app not yet set up is refused with `totp_setup_required` (a new reason in `MOBILE_AUTH_REASONS`): it is set up on the website.
- **Access token:** ES256, 15 minutes, claims `MobileAccessClaims` (`sub`, `sid` = installation, `bos_role`, `entity_ids`, `jti`), signed with the field app's own pair `MOBILE_JWT_PRIVATE_KEY`/`MOBILE_JWT_PUBLIC_KEY` (one-line JWK; `apps/web/scripts/mobile-keys.ts` prints a pair; never published in the JWKS). Without the pair the routes answer `integration_unavailable`.
- **Refresh token:** 256 random bits (43 characters), stored only as its SHA-256 hex in `mobile_devices.refresh_token_hash`, with `refresh_family_id`, 30 days from each issue. One row per person and installation, at most one live row per installation (a partial unique index); a sign-in starts a new family and signs any other person's live row on the installation out.
- **Rotation and reuse:** a refresh locks the installation's live row (`select … for update`) and rotates only when the presented hash is the live one, so of two refreshes sent at once with one token exactly one gets a pair and the other finds the token rotated away. A token that is not the installation's live token (a rotated one presented again, or a live token sent with another installation's id) signs that row out with `refresh_reused`, which ends every token of the family; a signed-out phone's token answers `device_revoked`; a live token past its 30 days `refresh_expired`.
- **Revocation:** every bearer call reads the phone's row (`auth_service`, by `(user_id, device_id)`), so a phone signed out from the web, by the app (`/revoke`) or by another person's sign-in is refused at its next call (`device_revoked`), and an access token issued before the phone's latest sign-in (`signed_in_at`) is refused too. No 60-second cache: the read is one primary-key lookup.
- **The bearer's context:** after the phone check the person is resolved by `resolvePrincipalFromGrants()` over all their companies, exactly as a session with no company chosen, cached 60 s under the person's version counter (key `mobile:<installation>`), and the route runs inside `withRequestContext()` through `executeQuery()`/`executeCommand()`. A suspended person answers `account_suspended`.
- **Version gate:** every mobile route refuses a missing or lower `X-App-Version` (and a lower version in the token or refresh body) with `app_update_required` before anything else. Minimum `WORKSHOP_DEFAULTS.field.minimumAppVersion` (`1.0.0`), raised by `FIELD_MIN_APP_VERSION`; `FIELD_LATEST_APP_VERSION` names the newest release for `/me`.
- **Caps** (the existing key-value counter): sign-in 30 per address and 10 per account per 15 minutes; refresh 120 per address and 10 per phone per 15 minutes; bearer routes 600 per phone and 1,200 per address a minute.
- **Idempotency front:** `executeCommand(…, { idempotencyKey, idempotencyFront: keyValue })`. After the commit the answer is kept a day under `idem:<principal>:<key>`; a repeat runs the runner's own parse, mask and guard (`checkedInput()`, extracted from the runner), and only an exact repeat (same command and input hash) is answered from the store, through the same stored-answer check as the table (`storedAnswer()`, extracted). Anything else, and a store that does not answer, goes to `idempotency_keys`, which stays the authority. No mobile mutation route exists yet (F2's sync), so the front is used by tests only.

**Built (files).**
- Contracts: `field.device.revoke` (catalogue, scopes); `commands/admin/feature-flags.ts` (`SetFeatureFlagInput`, `FeatureFlagDto`, `FeatureFlagKeySchema`, now used by `MeResponse`); `commands/field/devices.ts` (`RevokeMobileDeviceInput`, `MobileDeviceDto`, `MOBILE_DEVICE_REVOKE_REASONS`); `totp_setup_required`; three auth audit events; the route error lists in `endpoints.ts`; text redaction of `Bearer …` and JWTs.
- Database: `mobile_devices` and `feature_flags` (schema `mobile-devices.ts`, `feature-flags.ts`; migrations 0240 generated and 0241 custom: RLS forced, the policies, column grants, triggers); `AUTH_TABLES` and `CONFIG_TABLES`; seed and oracle for `field.device.revoke` (Executive all, GM and Project Manager entity) and its row in SECURITY §3.2; `enum-sync` pairs; `db:docs` regenerated (the generator lists `mobile_devices` under Identity).
- Domain: `admin.flag.set` and `field.device.revoke` (registered, people only); `listMobileDevices`, `readFeatureFlags`, `resolveFeatureFlags`, `fieldAppProfile`; `idempotency/front.ts` and the `idempotencyFront` option; `WORKSHOP_DEFAULTS.field` (5 days offline, minimum `1.0.0`); a field named as any token is now dropped from logs and audit rows.
- Web: `apps/web/src/auth/mobile-keys.ts`, `mobile-tokens.ts`, `mobile-devices.ts`, `mobile-sign-in.ts`, `mobile-version.ts`, `mobile-bearer.ts`, `mobile-routes.ts`; routes `api/v1/auth/mobile/{token,refresh,revoke}` and `api/v1/me`; `signInFromFieldApp()` in `create-auth.ts`; `mobileKeyProblems()` in `productionConfigProblems()`; `signingKey()` exported from `realtime/keys.ts`; `.env.example` and `turbo.json` (four variables); error sentences, permission and Activity log labels in `en.json`.
- Documents: API §1 and §3.1 (built rows), SECURITY §2 and the log redaction, DATABASE §6.1 and §6.10, ADR 0012 accepted with the adapter corrected (WatermelonDB's own SQLite adapter with JSI, not expo-sqlite).

**Tests added.**
- `apps/web/tests/mobile-auth.test.ts`: 21 on real Postgres (sign-in and the hash-only store, no website session left, wrong password and unknown address alike, an Executive's code asked, refused and taken, `totp_setup_required`, the version gate in header, body and raised minimum, caps per account and per address, no key pair; rotation and reuse ending the family, two concurrent refreshes, a live token from another installation, refresh and access expiry, the refresh cap; a phone signed out from the web, by the app and by another person's sign-in, a suspended person; `/me` with roles, codes, a company flag and versions; a missing, forged or old-app bearer; the bearer's principal, companies and leads equal to a website session's; no issued token in any log line, Better Auth log line or `auth.*`/`field.*` audit row; a Sentry event with the bearer, token fields and a JWT in text scrubbed).
- `packages/db/tests/security/mobile-devices.test.ts` (7) and `feature-flags.test.ts` (4); `packages/domain/tests/commands/field-foundation.test.ts` (7: denied, wrong company and happy path for both commands, the phones list); `idempotency-front.test.ts` (4); `resolveFeatureFlags` unit tests (3); the agent sweep inputs and the reader parity entries (`listMobileDevices`, `readFeatureFlags`, `fieldAppProfile`).

**Checks.**
- `pnpm test:security` on the worktree's Postgres (54333): db 64 files, 1,801 passed; domain 112 files, 1,530 passed; web 40 files, 482 passed. (The first run failed only the reader parity test, which then had the two new reads added; the second run is the one above.)
- Typecheck of `@shakti/contracts`, `@shakti/db`, `@shakti/domain` and `web`: clean. ESLint (`--max-warnings 0`) on every folder touched: clean. Unit tests: contracts 25 files, 340 passed; domain `src/command`, `src/queries/field`, `src/ports`, `src/audit` and the workshop defaults; web `src/screens`, `src/auth`, `src/realtime`, `src/observability`, the errors catalogue and i18n tests (46 files: 409 passed and the audit field test failing, which passed in a rerun of `src/screens`, 241, once the installation id left the auth events' fields). `pnpm copy-lint`: clean. `db:docs` regenerated and its test passing.
- Not run at this stage: the whole-repository `pnpm typecheck` and `pnpm lint`, `pnpm build` and `js-budget` (no page changed yet), journeys.

**`EXPLAIN (ANALYZE)` under RLS** (66 phones, 20 flag rows in the test database):
- A person's phones as a manager with `field.device.revoke:entity` (not their own): Bitmap Index Scan on `mobile_devices_user_device_unique`, the company test a hashed subplan over `user_entity_roles` (957 rows, seq scan 0.2 ms); 0.40 ms. As the person themselves: Index Scan on the same index, the subplan never run; 0.14 ms.
- The flags as `readFeatureFlags` reads them: BitmapOr of two Bitmap Index Scans on `feature_flags_entity_idx` (group rows and the request's companies); 0.05 ms.

**Decisions the brief did not settle (for the lead).**
- The minimum version is overridden by an environment variable (`FIELD_MIN_APP_VERSION`), not a feature flag: `feature_flags` holds on or off only, as the brief shapes it. Say if a flag row should carry it instead.
- The key pair is optional in `productionConfigProblems()`: unset, the routes answer unavailable; set, both halves must be one P-256 key. Making it required would stop every hosted deployment until the owner sets the secrets; the lead may want it required before F5's rollout.
- `account_locked` answers 401 with `Retry-After`, as API §3.1 lists it under `unauthorized`; `account_suspended` and `totp_setup_required` answer 403.
- A refresh token presented with a known installation id but not its live token always counts as reuse (the server keeps only the current hash, as the brief says), so a forged token with a stolen installation id signs the phone out rather than in; a lost answer to a refresh also signs the phone out, and the person signs in again. The app must send one refresh at a time.
- Field device revocation at entity scope reaches anyone who holds a role in one of the request's companies, even if they also work elsewhere (unlike account changes, 0056): a sign-out takes no access away.
- Feature flags: a person has a flag on when any of their companies has it on (a company's row wins over the group's there). Rows are switched, never deleted (no delete grant, as `CONFIG_TABLES` requires). `admin.flag.set` has no screen; the brief names none.
- The auth audit events record the app version only, not the installation id, which the Activity log could only show as an internal number; the row's device column names the phone's app and Android version.
- `feature_flags` went into `CONFIG_TABLES` (it starts empty), which required the table-level update grant the generic test asserts.

**Still to build after the early check:** `apps/field` (scaffold, tokens, screens, the copy catalogue and its copy-lint config, jest-expo tests), the native build CI job, Admin › Team members › phones with Revoke and its journey,. The `.env.example` generator note is already in. Sentry for React Native is in the design but its package is not in the approved list: I will name it in the final report rather than add it.

### 27-11-2026, cloud worktree of the lead's VM: done
**The lead's change to the early check: a lost refresh answer.** `mobile_devices` gains `previous_refresh_token_hash` and `refresh_rotated_at` (migration 0242). A rotation's new refresh token is not random but derived: an HMAC-SHA256 of the presented token under a key taken from the field app's private key (`nextRefreshToken()`, key `sha256("shakti-field-refresh\n" + d)`), so the server keeps no token and needs no encryption. The token the last rotation replaced, presented again within 120 seconds, is checked against the stored new hash and answered with that rotation's refresh token (same expiry) and a fresh access token; the row does not change. After 120 seconds, or for any older token, it is reuse as before. So two refreshes sent at once now both get the same refresh token, and the family never forks. A key pair rotation ends the retry window for the last rotation only. Tests: a lost answer then the retry at 90 s (same pair, the family goes on), the same retry after 121 s (`refresh_reused`, the family ended), two refreshes at once (both 200, one refresh token), a token two rotations back (reuse at once).

**Built since the early check (files).**
- `apps/field`: `app.json` (package `com.shaktiprime.field`, plugins expo-router, expo-secure-store, expo-local-authentication), `eas.json` (development profile, debug APK, no account id, the dev API address), `tsconfig.json` (extends `tsconfig.base.json`), `babel.config.js` (Expo's preset with NativeWind's JSX source, `nativewind/babel`, the legacy decorators plugin), `metro.config.js` (`withNativeWind`), `tailwind.config.js` (every colour `var(--<token>)`, spacing, radii and type sizes from `@shakti/tokens`; loaded by Tailwind's jiti, so it imports the tokens' TypeScript), `global.css`, `jest.config.js`, `.gitignore` (the generated `android/`).
- `apps/field/messages/en.json`, read through `src/i18n.ts` (values and one plural form).
- `src/theme.tsx`: the CSS variables set from `resolve('light' | 'dark')` by the phone's setting (`useColorScheme`). `src/config.ts`: the API address (`EXPO_PUBLIC_API_BASE_URL`, else app.json's) and the version.
- `src/auth/token-store.ts` (expo-secure-store, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`: refresh token, installation id, PIN and its tries, the person's name and email; the access token in memory only), `api.ts` (every call sends `X-App-Version`; answers the server's reason, or `offline`), `session.ts` (signed out, locked, ready or the update gate; one refresh at a time; five wrong PINs sign the phone out; offline after unlock works on the stored person), `session-context.tsx` (provider, the fingerprint adapter).
- Screens `src/screens/*` and routes `app/_layout.tsx` (the gate, then Today and Settings tabs), `app/index.tsx`, `app/settings.tsx`.
- Tests and test set-up under `src/test`.
- CI: `.github/workflows/ci.yml`, the *What changed* job's new `field` output and the job *Field app native build* (prebuild, `./gradlew assembleDebug` with Java 17, the APK kept 7 days); not a required check.
- Copy lint: `tools/copy-lint/copy-lint.config.json` reads `apps/field/messages`, and `biometric` and `signingOut` join the button keys (a checks file, named for the owner's `checks-ok` with `ci.yml` and `turbo.json`).
- Web: `apps/web/src/actions/field.ts`, `components/users/phones-sheet.tsx`, the Phones item and sheet in `users-screen.tsx`, the permission passed from `admin/users/page.tsx`; copy under `users.phones` and `users.menu.phones`.
- Journey: `apps/web/e2e/field-phones.spec.ts`, fixtures `e2e/setup/field.ts` and `FIELD_PHONES` in `e2e/support/users.ts`, one block in `seed.ts`.
- Documents: phase4 §6.4 *Built*, TESTING §6 (the new job), API, SECURITY and DATABASE for the retry window; `machines:docs` regenerated (the readme lists `WORKSHOP_DEFAULTS.field`).

**Tests added since the early check.**
- `apps/field` (jest-expo, 21 tests in 5 files):
  - the token store (3);
  - the session (8: sign-in to PIN, the code asked, unlock offline, five wrong PINs, signed out by the server, the update gate, one refresh for three callers, sign-out);
  - the API client (2);
  - the copy helper (2);
  - the screens (6: sign-in and its code and refusals, the notice after a sign-out, choosing and confirming the PIN, the PIN's tries and the fingerprint, the update gate opening the Play Store).
- `mobile-auth.test.ts` now has 22 tests (the retry window, above). `mobile-devices.test.ts` also proves the previous hash is not readable by `app_user`.
- Journey: `field-phones.spec.ts`, 2 tests per project: the phones of Geeta Kumari with axe and a snapshot; an Executive signs a project's phone owner's phone out.

**Checks.**
- `pnpm test:security` on 54333:
  - db: 64 files, 1,801 passed; domain: 112 files, 1,530 passed.
  - web: 40 files, 482 of 483 passed. `outbox-route.test.ts` failed once because outbox rows the journey seed had left were claimed in its batch; that file alone passed afterwards (12 of 12).
  - An earlier run in this round failed `alert-counts.test.ts` on an `agent_configs` row the journey seed writes (`0199e2e0-…a002`). I deleted that row from the local database and the next run passed it.
  - Both clashes come from running the journeys on the suites' database. A fresh database avoids them; the lead's integration uses one.
- `pnpm typecheck`, `pnpm lint` and `pnpm format:check`, whole repository: clean.
- `pnpm test` (all workspaces): only `docs/state-machines/readme.md` was stale; I regenerated it, and the domain unit tests then passed (111 files, 2,809).
- `pnpm copy-lint`: clean. `pnpm build`: passed. `pnpm --filter web js-budget`: "Every page is within its budget (65 pages)".
- Journeys: `e2e:seed`, then `playwright test field-phones.spec.ts` in this VM: 21 passed (15 sign-in setups and 6 journey tests, across desktop-light, desktop-dark and phone). The screenshots it wrote were not committed: the database was not fresh (the picture showed a suites' "test user" row), so the lead makes the three Linux baselines of `team-member-phones` at integration.
- `expo config` resolves the app; `expo prebuild --platform android --no-install` generated the Android project (package, scheme, biometric permission, no backup) and I removed it. Gradle was not run; the CI job is unproved until its first run.

**For the lead and the owner.**
- **Sentry for React Native:** the package is `@sentry/react-native`. The newest version at least two weeks old today is **8.35.0** (released 12-11-2026); its peers include `expo`, `expo-router` and `@react-navigation/native`. Not added.
- **Packages the lead may want to add** (not installed):
  - `expo-system-ui` (**58.0.7**, 28-10-2026): prebuild warns that `userInterfaceStyle` needs it on Android. The app's colours follow `useColorScheme()` either way.
  - `@types/jest`, or making `@jest/globals` resolvable: the app's tests are typed by a small declaration of my own (`src/test/jest-globals.d.ts`).
- **Jest version:** `jest` is pinned at 30.2.0, but jest-expo 58 handles Expo's lazy globals only from Jest 30.4. Without a fix every test file fails at teardown, so `src/test/lazy-globals.ts` makes those globals non-enumerable. A Jest bump to 30.4 or later would remove the need.
- **Reanimated:** NativeWind's Babel preset loads `react-native-reanimated/plugin`, which resolves only because pnpm installed `react-native-reanimated` 4.8.0 as a peer of `react-native-css-interop`. It is not a direct dependency, so native autolinking may leave it out of the APK. The first native build will show whether it needs adding. WatermelonDB is installed but not wired (F2 owns the app's database); its native module compiles in the first CI run too.
- **Who can open Phones:** only Executives can, because Team members needs `admin.users.write`. A GM or Project Manager holds `field.device.revoke` at entity scope but has no screen to use it from. Say if they should get one (a page under Projects, or Team members opened to them).
- **API address in `eas.json`:** the development profile points at `https://shakti-prime-dev.vercel.app/api/v1`, and production defaults to `https://shaktiprime.com/api/v1` (API §1).
- **Installation id:** it comes from `crypto.getRandomValues` where the runtime has it, else `Math.random`. It is an identifier, not a secret: knowing it lets someone sign the phone out, never in.
- **PIN storage:** the PIN is kept in expo-secure-store as typed (Keystore-sealed); no hashing package is approved.
- **`AGENTS.md` §3** still marks `apps/field` as planned; that line is the lead's.

### The lead (27-11-2026): the packages the report named, approved by the owner
The owner approved six packages on 27-11-2026, and the lead installed them on this branch:
- `@sentry/react-native` 8.28.0 (Expo SDK 58's listed version);
- `expo-crypto` 58.0.8;
- `expo-system-ui` 58.0.7;
- `react-native-reanimated` 4.7.1 and `react-native-worklets` 0.13.0 as direct dependencies;
- `jest` 30.5.2.

`@sentry/cli`'s download script is set off in `allowBuilds`, because nothing here uploads source maps.

The fix round wires them in, beside the review's findings:
- the installation id from `expo-crypto` (no `Math.random` fallback);
- the PIN kept as a salted SHA-256 in secure storage, never as typed;
- Sentry for React Native with the web's scrubbing rules (`beforeSend` dropping tokens, phone numbers and identity numbers, as `apps/web/src/observability` does);
- `expo-system-ui` in the plugins;
- the lazy-globals workaround removed if Jest 30.5 makes it unneeded.

Also explain `pnpm peers check`'s missing `expo`, `react` and `react-native` peers of `expo-sqlite`, which were already there before these packages.

### 27-11-2026, cloud worktree of the lead's VM: fixes
Every finding the lead marked to fix (1, 2, 3, 5, 6, 7, 8), finding 4 recorded, and the six packages wired in. Skills loaded: none (`add-command` and `add-table` do not apply: no new command or table; this session lists no other skill the brief names).

**Finding 1 (critical), `cf117266`.** `resolveMobilePrincipal(userId, deviceId, deps)` now builds the cache's session part itself, `mobile:<installation>:<person>` (`mobileCacheSession()`), and uses a cached entry only when `cached.principal.id === userId`. The three callers (token, refresh, bearer) pass the installation id, never a prebuilt key. Tests in `mobile-auth.test.ts`, *people who share one installation*: (a) A calls `/me`, B signs in on A's installation at once, B's token claims and `/me` and bearer principal are B's (role, companies, leads equal to B's own resolution), then A signs in again with B's entry still cached and is A again, leads included; (b) someone copies the `sid` out of A's access token and signs in with it: their token, `/me` and principal are their own. Both tests failed against the old code (B's token carried A's `field_engineer` role; the intruder's too) and pass now.

**Finding 2, `02733c1e`.**
- Domain: `revokeUserSessions()` (the one helper the three commands use: `admin.user.role.set`, `admin.user.suspend`, `admin.user.two_factor.reset`) also signs every live phone of the person out in the same transaction, with the sessions' reason and `revoked_by` the acting person.
- Auth: `authDeviceStore.signOutEverywhere(userId, reason, now)`, called from Better Auth's `onPasswordReset` (the forgotten-password link) and from the after hook of `/change-password` when `revokeOtherSessions` is true (the only way the website changes a password).
- `MOBILE_ACCOUNT_CHANGE_REASONS` (`password_changed`, `role_changed`, `suspended`, `totp_reset`, typed as a subset of the session reasons) join `MOBILE_DEVICE_REVOKE_REASONS`; the check constraint is widened (migration 0243, `NOT VALID` as DATA-5 requires); Team members › Phones shows them in the sessions' words.
- Migration 0244 adds two policies on `mobile_devices` that mirror `sessions_read` and `sessions_update` (0014, 0056): a holder of `admin.users.write:all` reads the phones' columns without a secret and signs out the phones of a person with no role outside the request's companies. Without them an Executive whose role was customised to drop `field.device.revoke` would end the sessions and leave the phones signed in without a word.
- Tests: `mobile-auth.test.ts` *a person's phones are signed out with their website sessions* (5: a password change, a reset by link, an authenticator reset, a role change and a suspension, the last three by an Executive without `field.device.revoke`; each checks the row's reason and that `/me` and a refresh answer `device_revoked`); `mobile-devices.test.ts` one more (the account-change policy, and its company rule). The test *a suspended person is refused* now sets the status directly, since the command now signs the phone out first; it keeps the `account_suspended` branch covered.
- SECURITY §2: the sessions line and the authenticator reset name the phones.

**Finding 3, `f731f1d0`.** The session keeps the access token with the time to stop using it: fifteen minutes (`TOKEN_LIFETIMES.mobileAccess`) from when it arrived, on the phone's clock, less a minute (`REFRESH_BEFORE_EXPIRY_MS`). `accessToken()`, `/me` and sign-out use it only before then and refresh otherwise. A bearer refusal with no reason (`unauthorized`) is answered by one refresh and one more try (`withBearer()`); only a second refusal signs the phone out, now with its own sentence (`errors.unauthorized`, field catalogue). Sign-out goes through the same path, so an old token is refreshed and the server's row ends. Tests: the minute before expiry, the retry, the second refusal, sign-out after 16 minutes.

**Finding 5, `2cce8480`.** `fieldVersionProblems()` (in `mobile-version.ts`) reports a `FIELD_MIN_APP_VERSION` or `FIELD_LATEST_APP_VERSION` that is set but not three numbers; `productionConfigProblems()` lists it. Test in `deps.test.ts`.

**Finding 6, `f731f1d0`.** `phoneDetails()` (`src/config.ts`) reads `Platform.constants.Model` and `Release` (the Android version, falling back to `Platform.Version`), cut to the server's 80 and 20 characters, and a sign-in sends them. Test: the sign-in body carries them.

**Finding 7, `f731f1d0`.** `SessionProvider` listens to `AppState`; the session notes when the app went to the background and, back after 5 minutes or more (`LOCK_AFTER_BACKGROUND_MS`), goes to `locked` (the PIN or fingerprint), keeping the sign-in. Test: 4 min 59 s stays open, 5 min locks, the PIN opens it. Phase4 §6.4's *Built* says so.

**Finding 8, `2cce8480`.** The `MobileAccessClaims` comment says the phone's row is read on every call and the role and companies in the token are informative only; `auth.mobile.revoke` and `me` list `integration_unavailable` in `endpoints.ts` and API §3.1.

**Finding 4: recorded** in SECURITY §2 as a known limit (accepted 27-11-2026), with the reason.

**The six packages, `f731f1d0`.**
- `expo-crypto`: the installation id is `Crypto.randomUUID()` (no `Math.random`); the PIN is kept as `v1:<16-byte salt>:<SHA-256 of salt and PIN>` in hex (`getRandomBytes`, `digestStringAsync`), compared in full; the store answers `hasPin()` and `pinMatches()`, never the PIN. A kept value in another form never matches. Jest mocks the module with Node's crypto.
- `@sentry/react-native`: `src/observability/sentry.ts` starts it once from the app's frame, only when the build names `EXPO_PUBLIC_SENTRY_DSN` (and `EXPO_PUBLIC_SENTRY_ENVIRONMENT` if set), with no screenshot, view hierarchy, replay, failed-request capture or traces, and `sendDefaultPii` left at its default, off. `src/observability/sentry-scrub.ts` follows the web's rules with the contracts' `redactText` (`@shakti/contracts/masking`): the request to its method and path, the person to their id, no tags, the phone's name dropped, any field named as a token, the password, the PIN, a code, the installation id, headers or a body dropped, every other text scrubbed (bearer and signed tokens, email addresses, phone numbers to their last four digits, identity numbers), frames without their variables. Tests: an event and a breadcrumb full of secrets come out clean; the start sends nothing without a DSN and scrubs with one.
- `expo-system-ui`: in `app.json`'s plugins; prebuild no longer warns, and writes `expo_system_ui_user_interface_style` = `automatic`.
- `react-native-reanimated` and `react-native-worklets`: direct now, so autolinking includes them; nothing to wire (NativeWind's Babel preset loads the plugin).
- `jest` 30.5.2: the lazy-globals workaround (`src/test/lazy-globals.ts`, `after-env.ts` and the `setupFilesAfterEnv` line) is removed; all suites pass without it.
- **`pnpm peers check`'s missing peers of `expo-sqlite`:** `drizzle-orm` declares `expo-sqlite` as an optional peer, and since `apps/field` brought `expo-sqlite` into the workspace pnpm links it to every `drizzle-orm` it resolves. `packages/domain`'s `drizzle-orm` (lockfile importer `packages/domain`: `drizzle-orm@0.45.4(…)(expo-sqlite@58.0.17)(…)`) gets it in a package without `expo`, `react` or `react-native`, so `expo-sqlite`'s own peers are unmet there. Nothing on the server loads `expo-sqlite` (only `drizzle-orm/expo-sqlite` would), so it is harmless, and typecheck is clean across the packages. It dates from the lead's first commit that added `apps/field`. A lockfile fix (for example `peerDependencyRules.ignoreMissing` for `expo-sqlite`'s peers, or `pnpm dedupe`) is the lead's.

**Also fixed (not in the review).**
- `apps/web/scripts/measures/safety.test.ts` failed: the early check's `MOBILE_JWT_PRIVATE_KEY` and `MOBILE_JWT_PUBLIC_KEY` in `.env.example` were in neither of the measures' lists. They join `KEPT_LOOKALIKES.appKeys` (the app's own keys, sent to no one), `5be84daa`. That file is G2's; the change is one block under a comment naming F1.
- `migration-rules.test.ts` (DATA-5) refused 0243's widened check written whole; it is `NOT VALID` now, `e9b34c9c`.

**Tests added in this round.** `mobile-auth.test.ts`: 7 (2 shared installation, 5 account changes), 29 in all; `mobile-devices.test.ts`: 1 (8 in all); `deps.test.ts`: 1; `apps/field`: 9 (session 5, token store 1, Sentry scrub 2, Sentry start 1), 30 in 7 files.

**Checks.**
- `pnpm test:security` on 54333 (migrated with 0243 and 0244 as first written): db 64 files, 1,802 passed; domain 112 files, 1,530 passed; web 40 files, 490 passed.
- `pnpm typecheck` (whole repository): 11 tasks successful. `pnpm lint` (whole repository, `--max-warnings 0`): clean. `pnpm format:check`: clean. `pnpm copy-lint`: clean. `pnpm build`: passed. `pnpm --filter web js-budget`: "Every page is within its budget (65 pages)". `pnpm db:docs` regenerated (the reasons check).
- Unit tests (`turbo run test --force`): tokens 146, copy-lint 17, ui 107, voice 49, voice-agent 23, field 30, contracts 340, db 162 (after the `NOT VALID` fix), domain 2,809, web 1,241 passed and 1 skipped with the measures test failing, which passes after `5be84daa` (`scripts/measures`: 25 passed).
- `expo config` resolves; `expo prebuild --platform android --no-install` generated the project (package, biometric permission, no backup, the system UI style) and I removed it. Gradle not run.
- **Journey not run in this round:** `e2e:seed` refuses this database because 0243 changed on disk after it ran here (the `NOT VALID`). **A fresh database is needed** for `field-phones.spec.ts`; the lead's integration uses one. The phones sheet changed only by four reason labels.

**`EXPLAIN (ANALYZE)` under RLS** (86 phones), as an Executive holding `admin.users.write` but not `field.device.revoke`, so the new policy is the one that admits:
- The phones list (`listMobileDevices`' statement): Bitmap Index Scan on `mobile_devices_user_device_unique`, the policies as one-time InitPlans with the company subplan never run; 0.20 ms.
- The sign-out in `revokeUserSessions`: BitmapAnd of `mobile_devices_user_device_unique` and the partial `mobile_devices_live_device_idx`, the scope subplans (`user_roles_outside_request`) never run once no live row matches; 4.1 ms.

**Decisions the triage did not settle (for the lead).**
- A role change signs the phones out too, because it runs through `revokeUserSessions()` and ends the website sessions (SECURITY §2's "a role change revokes sessions").
- The two new policies let `admin.users.write:all` read and sign out phones under the sessions' company rule, also for `app_reader` (read only), so the reader parity holds for an Executive without `field.device.revoke`.
- `revoked_by` is the acting Executive on the command paths and empty on the password paths (the person themselves, through the auth module).
- The access token's expiry is counted from its arrival on the phone's own clock with the contract's lifetime, not from `accessTokenExpiresAt`, which a phone whose clock runs ahead would read as already past (a refresh on every call, then the refresh cap).
- A bare `unauthorized` after the retry signs the phone out with a new sentence, "Your sign-in on this phone has ended. Please sign in again." (field catalogue), rather than "Something went wrong on our side".
- Sentry's Expo config plugin (`@sentry/react-native/expo`) is not added: it uploads source maps, which nothing here does. The DSN and environment come from `EXPO_PUBLIC_SENTRY_DSN` and `EXPO_PUBLIC_SENTRY_ENVIRONMENT` per EAS profile; none is set in `eas.json` yet (the owner's Sentry project).
- The local database still holds 0243 as first applied (a valid check); a fresh database gets it `NOT VALID`, as the import kinds' checks already are.

### 27-11-2026, cloud worktree of the lead's VM: fixes 2
Findings 9 and 11 of the re-check, as the lead's triage asks; finding 10 recorded. An earlier agent on this lane pushed the two fix commits and was stopped before its checks and this report; I read both diffs against `5fd64d1f`, found them complete against the triage, formatted one test file (`pnpm format:check` failed on it) and ran the checks. Skills loaded: none (no new command or table).

**Finding 9 (medium), `e6edc437`.**
- `redact()` and its field rules (`IDENTITY_KEYS`, `normaliseKey`, `CODE_KEYS`, `isCodeKey`, `isMeasureKey`, `isLongNumber`, `fieldKind`, `keepsAsCode`, `scrubValue`, `redactError`) move unchanged from `packages/domain/src/ports/redaction.ts` to `packages/contracts/src/masking/redaction.ts` (pure, no import beyond the masking folder); the only difference is the import of `redactText` from its sibling. The domain module re-exports them, so `@shakti/domain/redaction` (the web's Sentry scrub and error reports, the logger) is unchanged. One copy, no second list.
- `apps/field/src/observability/sentry-scrub.ts`: `scrubFields()` drops the fields only a phone carries (its PIN, authenticator and backup codes, which `redact` would keep as codes; the installation id; headers and bodies; an address cut to its path) and then runs `redact()`. A number of ten digits or more becomes `[number]`, every identity key `[redacted]`, text is scrubbed as the logs are (a phone in text to its last four digits).
- Tests: `sentry-scrub.test.ts` gains *hides a number of ten digits or more and every identity field, as the web does* (each of `IDENTITY_KEYS`, and `panNumber`, `aadhaarNumber`, `accountNo`, `bank_account_number`, `ifscCode`, `uid`, a numeric `mobile`, `phone` and `whatsapp`, in extra, contexts, breadcrumbs and spans); `sentry.test.ts`'s token field now reads `[redacted]` rather than being dropped.

**Finding 11 (low), `4b1db1f2`.**
- `admin.role.permissions.set`: `revokeHolderSessions` signs every holder's phone out, the editor's included, with `role_changed` and `revoked_by` the editor, in the command's transaction, through `signOutPhones()` (now shared with `revokeUserSessions()` in `admin/shared.ts`). Should the policy hold a phone back, the save is refused with `role_holders_kept`, as for sessions (`livePhoneCount()` before, the signed-out count after).
- An authenticator enrolment: `finishEnrolment()` calls `authDeviceStore.signOutEverywhere(userId, 'totp_enrolled', now)`, as the triage asks. `totp_enrolled` joins `MOBILE_ACCOUNT_CHANGE_REASONS`, the phones' reasons check (new migration, `NOT VALID`), the schema, the Phones sheet's labels (`en.json`: "Authenticator app set up") and `docs/data`.
- Tests: `admin-roles.test.ts`, the change test checks every holder's phone signed out with the editor as `revoked_by` and a bystander's phone untouched, and the archived-company test checks its holder's phone; `mobile-auth.test.ts` gains *when they set up an authenticator app* (enrols on the website, calls `finishEnrolment()`, then the phone's row reads `totp_enrolled` and `/me` and a refresh are refused). `createTestMobileDevice()` joins `@shakti/db/testing`, replacing the copy in `field-foundation.test.ts`.
- SECURITY §2 (Sessions and Mobile) names both paths; DATABASE's `mobile_devices` row lists the account-change reasons, `totp_enrolled` included.

**Finding 10: recorded** in SECURITY §2, Mobile, as a known limit (accepted 27-11-2026), and in the comments of `sentry.ts` and `sentry-scrub.ts`.

**Tests added in this round.** `apps/field`: 1 (31 in 7 files); `mobile-auth.test.ts`: 1 (30); `admin-roles.test.ts`: phone assertions in 2 existing tests.

**Checks** (all through the lock, on 54333):
- `pnpm db:migrate` applied the new migration (the reasons check now lists `totp_enrolled`, `convalidated = f`); `pnpm db:seed` passed.
- Security, db: `mobile-devices`, `enum-sync`, `app-reader`, `role-entity-matrix`: 4 files, 112 passed. db docs (`src/docs`): 2 files, 23 passed.
- Security, domain: `admin-roles`, `field-foundation`, `admin-two-factor`, `admin-users`: 4 files, 38 passed; `audit-trail`: 13 passed.
- Security, web: `mobile-auth`, `auth`, `actions`: 3 files, 105 passed.
- Unit: contracts 340, db 162, domain 2,809, web 1,242 passed and 1 skipped, voice-agent 23, field 31 (7 suites).
- Typecheck of contracts, db, domain, field and web: clean. `pnpm lint` (whole repository, `--max-warnings 0`): clean. `pnpm copy-lint`: clean. `pnpm format:check`: clean after formatting `mobile-auth.test.ts`.
- **Not run:** the whole `pnpm test:security`, `pnpm build`, `js-budget` and the journey `field-phones.spec.ts`. `e2e:seed` refuses this database because 0243 changed on disk after it ran here; **a fresh database is needed** for the journey, at integration. The screens changed only by one reason label.

**`EXPLAIN (ANALYZE)`** of `livePhoneCount()`'s statement (38 phones on this database, so the planner chose a sequential scan, 0.065 ms; with `enable_seqscan` off): Bitmap Index Scan on `mobile_devices_user_device_unique` for `user_id = any(...)`, `revoked_at is null` as a filter, 0.076 ms. The sign-out's statement is the one measured in the first round.

**Decisions the triage did not settle (for the lead).**
- The editor's own phones are signed out by a role-permissions edit (their website session is kept, as before): a phone cannot be named as the one to keep, and the editor may hold the role.
- An enrolment's phone sign-out has its own reason, `totp_enrolled`, which the website sessions already use, rather than reusing `totp_reset`.
- A token field (`refreshToken`) now reaches Sentry as `[redacted]`, as on the web, rather than being dropped; the phone's own secret fields are still dropped.

## Review

### 27-11-2026, slice reviewer (Opus 5.5, high), commit `a7a7907a`
**Verdict: blocked.** One critical and one high finding must be fixed before the merge.

| # | Severity | Where | What is wrong | Failure scenario | Fix | Status |
|---|---|---|---|---|---|---|
| 1 | critical | `apps/web/src/auth/mobile-bearer.ts:93-96` with `principal-cache.ts:46`; callers `mobile-routes.ts:210-214`, `:315-319`, `mobile-bearer.ts:158` | The principal cache key is `principal:${sessionId}:all:${version}` and holds no user id. The website's session id is unique to one person, but the mobile bearer passes `mobile:<installation id>`, which every person signing in on that installation shares. The token route even takes it from the request body (`body.device.deviceId`). `resolveMobilePrincipal()` returns any cached entry without checking `cached.principal.id === userId`. The person's version counter is `'0'` until something invalidates it, so two people's keys usually match. | **Shared phone:** an Executive (A) signs out in Settings. The revoke route resolves and caches A's principal for 60 s. A Field Engineer (B) then signs in on the same phone within that minute. The token route reads A's principal, so B's access token carries A's `bos_role` and `entity_ids`. B's `/me` and every bearer call then run as A until the entry expires: `principal.id` is A, A's permissions apply, row security reads as A, and audit rows name A. **Attack:** anyone with valid credentials who knows an installation id can do the same on purpose. They sign in with `device.deviceId` set to that id within 60 s of its owner's last call. I reproduced it with the real `resolveMobilePrincipal()` and `memoryKeyValue()`: a tele-caller asking with the Executive's installation got the Executive's principal. No test covers two people on one installation: "by another person signing in on the same installation" checks only the first person's refusal. | Key the mobile cache by person and installation, for example `mobile:${userId}:${deviceId}`, or better the `mobile_devices` row id or `refresh_family_id`. Also refuse a cached entry whose `principal.id !== userId` (one line, defence in depth). Add a test on real Postgres: A calls `/me`, B signs in on A's installation, and B's `/me` answers B's principal. Add one more: B sends A's installation id on purpose. | confirmed (reproduced) |
| 2 | high | `apps/web/src/actions/auth.ts:250-256` (`changePassword` with `revokeOtherSessions`), `create-auth.ts:431` (`revokeSessionsOnPasswordReset`), `packages/domain/src/commands/admin/two-factor-reset.ts:44` and `shared.ts:118` (`revokeUserSessions`) | Changing or resetting a password, or an Executive's authenticator reset ("signs the user out everywhere", SECURITY §2), ends only `sessions` rows. Nothing in those paths touches `mobile_devices`: only `mobile-devices.ts`, `revoke-device.ts` and the phones query do. Each rotation also sets `refresh_expires_at` to now + 30 days, so a phone in use stays signed in with no end. | A person's password leaks, and someone signs in on their own phone through `/auth/mobile/token` (no bot check). The person, or an Executive, does the usual thing: resets the password and the authenticator app. The website sessions end, but the other phone keeps refreshing every 15 minutes for good. The person cannot see their own phones, and only an Executive who thinks to open Team members › Phones can end it. For a role that does not need an authenticator app, the authenticator reset also leaves the phone signed in. | When a password is changed or reset, and in `admin.user.two_factor.reset` and `admin.user.suspend`, sign out every live phone of the person (`revoked_at`, a reason such as `revoked`), in the same place the sessions end. The command paths can do it through `app_user`'s update grant. The Better Auth paths do it through `authDeviceStore`. Add a test for each path, and correct SECURITY §2's sessions lines to name phones. | confirmed (code read end to end) |
| 3 | medium | `apps/field/src/auth/session.ts:222`, `:271-277`, `:365-372`, and `SIGNED_OUT` at `:202-209` | The app keeps the access token in memory with no expiry time and never refreshes it before use. `accessToken()`, `readMe()` and `signOut()` reuse it after its 15 minutes. The server answers an expired token with `unauthorized` and no reason, and the app treats a bare `unauthorized` as "signed out". | After 15 minutes in the app, a person taps Settings › Sign out. `api.revoke(expired)` is refused, the app ignores the result and clears its own store, but the phone's row stays live on the server. Team members › Phones still shows "Signed in", and a copied refresh token keeps working. Once F2's sync uses `accessToken()`, the first call after 15 minutes signs the person out (`refused('unauthorized')`). | Keep `accessTokenExpiresAt` and refresh when the token is within about a minute of expiry. For a bearer `unauthorized` with no reason, refresh once and try again before signing out. Add session tests for both. | confirmed (code read) |
| 4 | low | `apps/web/src/auth/mobile-devices.ts:166-182`; `mobile-routes.ts:274-279` | A refresh token the server has never seen, sent with a known installation id, signs that phone out (`target = holder ?? live`). Anyone who knows the id can also use up the phone's 10 refreshes per 15 minutes. The builder named this. | Anyone who learns an installation id (it is the `sid` claim of every access token, readable by anyone who sees one) can sign the phone out at will, or hold it at `rate_limited`. | Accept and record it (the reuse rule depends on it), or count a hash the row never held as `unknown` rather than reuse, which gives up reuse detection for tokens two or more rotations back. The owner's call. | plausible |
| 5 | low | `apps/web/src/auth/mobile-version.ts:183-197`; `deps.ts` | The brief asks for `minimumAppVersion` "overridable by a flag". It is an environment variable (`FIELD_MIN_APP_VERSION`), which needs a redeploy. The builder named this. A value the server cannot read is also ignored without a word, and `productionConfigProblems()` does not check it. | The owner sets `FIELD_MIN_APP_VERSION=1.2` to force an update. The server reads `1.0.0` and every old app keeps working. | Report a value that is set but unreadable in `productionConfigProblems()` (one line). Leave the flag versus variable choice to the lead. | confirmed |
| 6 | low | `apps/field/src/auth/session.ts:317` | The app sends no `model` or `osVersion` in `device`, so every phone is listed as "Android phone". Phase 4 §6.4 says the request carries "the device's id and name". | Someone with two phones loses one. The Executive sees two identical "Android phone" rows and cannot tell which one to sign out. | Send `Platform.constants.Model` and `String(Platform.Version)` from `react-native` (no new package). | confirmed |
| 7 | low | `apps/field/app/_layout.tsx`, `session.ts:304-310` | The PIN or fingerprint is asked only when the app process starts. An app that comes back from the background opens straight to Today. | A phone left unlocked with the app in memory opens without the PIN. Only the phone's own screen lock stands in the way. | Lock again with `AppState` after a few minutes in the background. If the design means a lock only at start, say so in §6.4. | plausible |
| 8 | low | `packages/contracts/src/api/mobile-auth.ts` (the `MobileAccessClaims` comment), `endpoints.ts` (`auth.mobile.revoke`, `me`), API §3.1 | The claims comment still says the device's revocation is "checked from a 60-second cache", but the built check reads the row on every call. The error lists of `/revoke` and `/me` leave out `integration_unavailable`, which `signingSetup()` answers on every bearer route. | Readers and F2's client are told about behaviour the server does not have. | Fix the comment, and add `integration_unavailable` to both endpoints and API §3.1. | confirmed |

**Checked and sound:**
- **Rotation under concurrency.** `rotate()` locks the installation's live row (`for update`). Postgres re-reads the updated row for the waiting refresh, which then matches `previousHash` and the derived `newHash` and answers `retried`. Both callers get one refresh token and the family does not fork; `mobile-auth.test.ts` proves it on real Postgres. A token two rotations back, the replaced token after 120 s, and a live token sent with another installation's id all end the family. A revoked phone answers `device_revoked`, and a live token past its 30 days answers `refresh_expired`.
- **Derived refresh token.** It is an HMAC-SHA256 under a key taken from the private key (`d`): 43 characters, matching `RefreshTokenSchema`. Only SHA-256 hashes are stored, and the unique hash constraint holds.
- **Revocation.** Every bearer call reads the phone's row, so there is no cache to go stale. A token issued before the phone's latest sign-in is refused (`iat < signed_in_at`). Another person's sign-in on the same installation ends the first person's row.
- **Version gate.** It runs first on all four routes, before any cap or read. The token route checks the header and `device.appVersion`, the refresh route the header and the body. A missing header is refused. `SemverSchema` and the database check agree.
- **Tokens in logs and Sentry.** No route logs a token, password, code or hash; `failed()` logs the event and the redacted error only. Sentry keeps only the request's method and path, with no headers or body (`sentry-scrub.ts`), and the new text rules remove `Bearer …` and JWTs. Any field named `*token` is dropped from logs and audit rows. The app keeps the refresh token in expo-secure-store with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, `allowBackup` is off, and no token appears in a URL or in `console`. Better Auth has no secondary storage, so deleting the website session row ends it.
- **The bearer's request context, apart from finding 1.** The person is resolved by `resolvePrincipalFromGrants()` over all their companies, like a website session with no company chosen, and `/me` reads through `executeQuery()` with a name. The claims' `bos_role` and `entity_ids` are never trusted. `/api` is outside the proxy's matcher.
- **Bot-check skip.** It is limited to `SIGN_IN_PATH` inside `signInFromFieldApp()`'s `AsyncLocalStorage`, which no client can set. The lock, the per-address cap and the second factor still run, and the per-account cap uses the email after `EmailSchema` lowercases it.
- **Data isolation.**
  - `mobile_devices`: row security forced. `auth_service` has full access. `app_user` and `app_reader` can read only the columns without a secret. Updates are limited to `revoked_*`, with `with check (revoked_at is not null)`, and there is no delete.
  - `feature_flags`: row security forced, and reads fail closed on a null user. Writes need `admin.flags.write:all` within the request's companies.
  - Both tables are in `AUTH_TABLES` or `CONFIG_TABLES`, and the `enum-sync` pairs, the seed and the matrix row are in place.
- **Commands.** Both are `peopleOnly`, with `auditFields` labelled and one `ctx.audit()` each. They are in the agent sweep and have their denied, wrong-company and happy-path tests. The reader parity entries are in. Cost permissions are untouched.
- **The idempotency front.** It answers only the same caller's exact repeat (same command and input hash), after the runner's own parse, mask and guard (`checkedInput()`). It checks the answer's company again (`storedAnswer()`) and goes to the table on a miss or a store failure.
- **The web.** Phones uses `executeQuery`/`executeCommand` through server actions, with one idempotency key per phone shown. Its copy is in `en.json`, and the journey has axe and a snapshot.
- **The CI job.** It runs only when `apps/field/**` or the lockfile changes, is not a required check, and keeps the APK 7 days.
- **Tests I ran** on the slice's database (54331), through the lock:
  - `apps/web/tests/mobile-auth.test.ts`: 22/22.
  - db `mobile-devices` and `feature-flags`: 12/12.
  - domain `field-foundation` and `idempotency-front`: 11/11.
  - `apps/field` jest: 21/21.

**Not checked:**
- The journeys (`field-phones.spec.ts`): this session cannot sign in, so I read the spec only.
- Layout (check 7): no Linux baselines of `team-member-phones` are committed yet. The lead makes them at integration.
- Not re-run; I relied on the builder's report: the whole-repository `pnpm lint`, `typecheck`, `build`, `js-budget` and the full `pnpm test:security`.
- The Android Gradle build: unproved until the first CI run.
- `EXPLAIN` figures: taken from the builder's report.

**The lead's triage (27-11-2026):**
- **To fix in the one fix round:**
  - **1:** the principal cache key carries the user id, for example `mobile:<installation>:<user id>`, and a cached entry is used only when `cached.principal.id === userId`. Add a test: two people sign in in turn on one installation, and each gets their own principal and leads.
  - **2:** every path that ends a person's website sessions also signs out their phones: a password change with `revokeOtherSessions`, the reset, the Executive's authenticator reset, and `revokeUserSessions`. Do it in one shared helper, with a test per path.
  - **3:** the app keeps the access token's expiry and refreshes before use when it is within a minute of it. Sign-out refreshes first when needed, so the server's row is ended.
  - **5:** an unreadable `FIELD_MIN_APP_VERSION` is reported in `productionConfigProblems()`.
  - **6:** send the model and OS version.
  - **7:** lock again after 5 minutes in the background (`AppState`).
  - **8:** fix the comment, and add `integration_unavailable` to both endpoints and API §3.1.
  - The six packages, as the note above says.
- **4: accepted and recorded.** The reuse rule depends on it, and the installation id is exposed only to whoever already holds the phone's token. Record it in SECURITY §2 as a known limit.
- **Finding 1 is critical, so the reviewer re-checks the fix diff.**

### 27-11-2026, slice reviewer (Opus 5.5, high), re-check of `d7ef81af..184c6e9e`
**Verdict: not blocked.** Every finding marked to fix is fixed with tests, and finding 4 is recorded. The fix round brings one medium and two low findings, none blocking.

**The first review's findings:**

| # | Status | Evidence |
|---|---|---|
| 1 (critical) | fixed | `mobile-bearer.ts:85-108`: the key is `mobile:<installation>:<person>` (`mobileCacheSession()`), and a cached entry is used only when `cached.principal.id === userId`. All three callers pass the installation id (`mobile-routes.ts:210`, `:311`, `mobile-bearer.ts:167`). The version counter is per person, so `invalidate()` still reaches the phones' entries. Two tests on real Postgres (*people who share one installation*): one for two people in turn, checking claims, `/me`, the bearer principal and the leads row security shows; one for an intruder who sends a copied `sid`. Neither helper bumps the version counter, so on the old code both people's keys were `principal:mobile:<id>:all:0`, and both tests would have failed there. |
| 2 (high) | fixed | `revokeUserSessions()` (`shared.ts:123-140`) signs every live phone out in the command's transaction, with `revoked_by` set. That covers role set, suspend and authenticator reset. `onPasswordReset` and the `/change-password` after hook (`revokeOtherSessions === true`, which the website's only caller, `actions/auth.ts:254`, always sends) call `authDeviceStore.signOutEverywhere()`. Migration 0244 mirrors `sessions_read` and `sessions_update` (0014, 0056) exactly, plus `revoked_at is not null` in the check. 0243 widens the reasons check `NOT VALID`; on this database it is `convalidated = f`. There is one test per path: five in `mobile-auth.test.ts`, the last three run by an Executive without `field.device.revoke`, each checking the row's reason and that `/me` and a refresh are refused. `mobile-devices.test.ts` has the policy test, with its company rule and the entity-scope denial. See finding 11 for two paths that are left out. |
| 3 | fixed | `session.ts`: `currentToken()` uses the token only until 15 minutes after it arrived, less one minute, on the phone's clock. `withBearer()` refreshes once on a bare `unauthorized` and tries again, and only a second refusal signs the phone out (`errors.unauthorized`, field catalogue). `signOut()` goes through `withBearer()`. Tests cover the minute before expiry, the retry, the second refusal, and sign-out after 16 minutes (revoke sent with the refreshed token). |
| 4 | recorded | SECURITY §2, Mobile, *Known limit (accepted, 27-11-2026)*. |
| 5 | fixed | `fieldVersionProblems()` (`mobile-version.ts:43`) is listed in `productionConfigProblems()` (`deps.ts:176`), with a test in `deps.test.ts`. |
| 6 | fixed | `phoneDetails()` (`config.ts`) sends `Platform.constants.Model` and `Release` (falling back to `Platform.Version`), cut to the contract's 80 and 20 characters. A test checks the sign-in body. |
| 7 | fixed | `SessionProvider` listens to `AppState`; `cameToForeground()` locks a `ready` session after 5 minutes or more away. Tests: 4 min 59 s stays open, 5 min locks, and the PIN opens it. `ready` always has a PIN, because the fingerprint is offered only at the `enter` step, so the lock never falls back to "choose a PIN". |
| 8 | fixed | The `MobileAccessClaims` comment is corrected. `integration_unavailable` is in `endpoints.ts` for `auth.mobile.revoke` and `me`, and in API §3.1. |

**The packages:**
- **`expo-crypto`:** `Crypto.randomUUID()` makes the installation id, with no `Math.random`. The PIN is kept as `v1:<salt>:<SHA-256>` and compared in full. Neither the store nor the session ever reads the PIN back.
- **`@sentry/react-native`:** it starts only with a DSN, sends no screenshot, view hierarchy, replay, failed requests or traces, and leaves `sendDefaultPii` off. `beforeSend`, `beforeSendTransaction` and `beforeBreadcrumb` all scrub. Nothing in `apps/field` calls `Sentry.setUser`, `setExtra`, `setContext`, `setTag` or `console.*`, so today no token, phone or identity number reaches Sentry. Two gaps remain against the web's rules: findings 9 and 10.
- **`expo-system-ui`:** in the plugins.
- **`react-native-reanimated` and `react-native-worklets`:** now direct dependencies.
- **Jest 30.5.2:** the lazy-globals workaround is removed.
- **`@sentry/cli`:** its download script is off in `allowBuilds`.

**New findings:**

| # | Severity | Where | What is wrong | Failure scenario | Fix | Status |
|---|---|---|---|---|---|---|
| 9 | medium | `apps/field/src/observability/sentry-scrub.ts:23-41`, `:61-75` (`SECRET_KEYS`, `scrubFields`) | The scrub does not follow the web's field rules. The web uses `redact()` from `@shakti/domain/redaction`, which `apps/field` may not import. Two gaps follow. **Numbers:** `scrubFields` returns a number untouched (`if (!isObject(value)) return value`), but the web hides any number of ten digits or more (`scrubValue`). **Identity keys:** `SECRET_KEYS` matches only exact names. It lacks most of `IDENTITY_KEYS` (`aadhaarnumber`, `aadhaarno`, `uid`, `pannumber`, `panno`, `accountno`, `bankaccountnumber`, `ifsccode`). A PAN such as `ABCDE1234F` has no long run of digits, so `redactText` leaves it whole. The tests pass strings only. | A later field screen (F2 onwards, customers and the OCR'd documents) records `extra: { mobile: 9876543210, panNumber: 'ABCDE1234F' }`, or a breadcrumb with that `data`. Both values reach Sentry whole, against SECURITY §5 and the owner's condition for the package. | Move `IDENTITY_KEYS` and the ten-digit number rule (`scrubValue`) from `packages/domain/src/ports/redaction.ts` into `@shakti/contracts/masking` beside `redactText`. Use them in `scrubFields`, and mask fields named `phone`, `mobile`, `whatsapp` or `email` to their last four characters, as the web does. Add test cases for a number value and for `panNumber`, `aadhaarNumber` and `accountNo`. | confirmed (code read) |
| 10 | low | `apps/field/src/observability/sentry.ts:5-11`, `sentry-scrub.ts:4-11` | The comments say every event passes through the scrub. Native Android crash and ANR events do not. `@sentry/react-native`'s `wrapper.js:162` strips `beforeSend` and `beforeBreadcrumb` from the native options, and `RNSentryStart.updateWithReactFinals` runs only a native `beforeSend`. Native events carry the scope the SDK copies from JS: user, tags, extra, contexts and breadcrumbs (already scrubbed by `beforeBreadcrumb`). | A later slice calls `Sentry.setUser({ email })` or `setContext('customer', …)`. A native crash then sends it unscrubbed. Nothing does this today. | Correct the two comments and state the rule: the field app sets nothing on Sentry's scope. Hold it with a check, for example a lint `no-restricted-syntax` on `Sentry.set*` in `apps/field`. Or set `enableNdkScopeSync: false`. | confirmed (SDK source read) |
| 11 | low | `docs/07-security.md` §2 (Sessions); `packages/domain/src/commands/admin/set-role-permissions.ts:263-290` (`revokeHolderSessions`); `apps/web/src/auth/session-principal.ts:185` (`totp_enrolled`) | SECURITY §2 now says "Every change that ends a person's sessions … signs their field app phones out". Two paths end website sessions but leave phones signed in: changing a role's permissions (`admin.role.permissions.set`) and a person enrolling an authenticator app. Grants do not go stale: the bearer resolves grants on every call, and `setRolePermissions` invalidates every holder's principal cache. | A reader of SECURITY §2, or the CA's audit, believes a role edit signs the role's phones out. It does not. | Either sign the holders' phones out in `revokeHolderSessions` under the same policy, or reword the sentence to name only the paths that do it. The second is a one-line edit. | confirmed (code read) |

**Checked and sound in the fix diff:**
- The 0244 policies grant nothing beyond the sessions' own rules. The read policy reads only through `app_user`'s and `app_reader`'s column grants, with no secret column. The update policy cannot sign a phone back in, and with `admin.users.write` at entity scope it updates 0 rows (tested). `app.user_roles_outside_request` is the existing definer the sessions policy already calls.
- `signOutEverywhere()` runs as `auth_service`, after a password change that worked (`!failed`, `actorId` set) or a reset. On an invitation's first password it finds nothing to sign out.
- The old test *a suspended person is refused* still covers the `account_suspended` branch, because it sets the status directly.
- The measures (`KEPT_LOOKALIKES.appKeys`) only add the field app's key pair, under a comment naming F1.
- Copy: four new labels on the Phones sheet in `en.json`, and one field sentence; `pnpm copy-lint` is clean.
- **For the lead:** the branch changes `pnpm-workspace.yaml` (`allowBuilds`, `7ce40cdf`), so its pull request merges only after the owner adds `checks-ok`.

**Tests I ran** on the slice's database (54331, migrated and seeded first), through the lock:
- `apps/web/tests/mobile-auth.test.ts`: 29/29.
- db `mobile-devices`, `app-reader`, `enum-sync` and `role-entity-matrix`: 112/112.
- domain `admin-two-factor`, `admin-users` and `audit-trail`: 31/31.
- web `deps.test.ts` and `scripts/measures`: 66/66.
- web `auth` and `actions` (security config): 75/75.
- `apps/field` jest: 30/30.
- `pnpm copy-lint`: clean.
- `@shakti/field` typecheck: clean.
- eslint (`--max-warnings 0`) on `apps/field/src`, `apps/field/app`, `apps/web/src/auth`, `packages/domain/src/commands/admin` and `packages/contracts/src/commands/field`: clean.

**Not checked:**
- The journey `field-phones.spec.ts`: this session cannot sign in, so I read it only. The builder did not run it either, because its database had 0243 as first written. It needs a fresh database at integration, and the Linux baselines are the lead's.
- Not re-run; I relied on the builder's report: the whole-repository `pnpm lint`, `typecheck`, `build`, `js-budget` and the full `pnpm test:security`.
- `EXPLAIN` figures for the new policies: taken from the builder's report.
- The Android Gradle build with the native Sentry, reanimated and worklets modules: unproved until the native build job runs.

**The lead's triage of the re-check (27-11-2026):**
- **9 (medium) and 11 (low): fix in a short second round.**
  - **9:** the field app's scrub uses the same rules as the web. Import the shared redaction from where the fences allow: `@shakti/contracts`' masking, or move `redact()` there if it is pure. Never keep a second copy. A test: a ten-digit number, and each identity key the web hides, scrubbed in an event.
  - **11:** a change to a role's permissions and an authenticator enrolment also sign the person's phones out, through `signOutEverywhere()`, with a test each.
- **10: accepted and recorded in SECURITY §2.** Native crash events skip the JavaScript scrub. The app puts nothing in the Sentry scope (no user, tags, extra or contexts), and breadcrumbs are scrubbed before they are kept.
- **No further re-check:** the lead reads this diff.

## Integration

### Integration prep (27-11-2026, cloud worktree of the lead's VM, the slice builder on Opus 5.5 at high)
- **Main taken in:** `origin/main` at `bdf82df4` (#298, X4 stock reasons, migration 0240); Q1 was not on `main` yet. Merge commit `25866cce`, made as [slice-integration §5](../../runbooks/slice-integration.md#5-take-main-into-the-slice) says: `git merge --no-commit origin/main` from `669f38a8`, `pnpm install --offline --frozen-lockfile` (lockfile up to date, nothing added), `renumber-migrations.mjs origin/main 669f38a8`, `pnpm db:generate` ("No schema changes, nothing to migrate"), `pnpm db:docs`.
- **Conflicts:** only generated files: `packages/db/migrations/meta/_journal.json` and `0240_snapshot.json` (the script restored `main`'s; journal entries 0 to 240 and the 0240 snapshot and SQL equal `main`'s byte for byte, the snapshot chain 0240 to 0246 links by `prevId`), and `docs/data/data-dictionary.md` and `erd.md` (regenerated). `apps/web/messages/en.json` merged with no marker; the JSON three-way merge from the merge base gives the same file, with no key changed on both sides.
- **Migrations' new numbers** (SQL verbatim from `669f38a8`, journal times after X4's `1795789276331`): 0240 → **0241** `f1_field_foundation`, 0241 → **0242** `f1_field_foundation_rls`, 0242 → **0243** `f1_refresh_grace`, 0243 → **0244** `f1_account_phones`, 0244 → **0245** `f1_account_phones_rls`, 0245 → **0246** `f1_enrolment_phones`. DATABASE §6.1 and §6.10 now cite them (`mobile_devices` Built (0241), the retry window 0243; `feature_flags` Built (0241)); the reports above keep the numbers they were written with.
- **Redefinitions checked against `main`'s latest:**
  - The slice's six migrations create or replace no function at all; they call `app.set_updated_at()` (0000), `app.user_id()` (0000), `app.has_perm()` (0000), `app.entity_ids()` (0012) and `app.user_roles_outside_request()` (0074), none of which X4 touches.
  - `app.platform_only_permissions()`: not redefined; `main`'s latest stands (0222). `field.device.revoke` and `admin.flags.write` are person permissions, not platform-only.
  - `notifications_type_check`: not redefined; `main`'s latest stands (0228). The slice adds no notification type.
  - `app.file_purpose_grant()`: not redefined; `main`'s latest stands (0235). The slice adds no file purpose.
  - Check constraints: only the slice's own tables (`mobile_devices_previous_hash_check`, `mobile_devices_rotation_pair_check`, and `mobile_devices_revoked_reason_check`, whose 0246 text is 0244's plus `totp_enrolled`, both `NOT VALID`).
  - Foreign keys: only from the slice's own tables, to `users`, `principals` and `entities`, which X4 does not alter. X4's only redefinition, `app.stock_move()`, is outside the slice.
- **Shared lists, a key used twice:** since the merge base `main` changed none of the lists the slice appends to (`permissions.ts` in contracts and seeds, `role-permissions.ts`, `testing/index.ts`, the registry, `workshop-defaults.ts`, `e2e/support/users.ts`, `turbo.json`, `.env.example`, `copy-lint.config.json`). Each key the slice added appears once in its list (`field.device.revoke` twice in the contracts file: the key list and its scopes); no duplicate journey user `key` (14) or e-mail; no duplicate key in either `en.json` or the copy-lint config; no duplicate in `.env.example` or `turbo.json`'s env lists.
- **Typecheck at once** (`pnpm typecheck` through the lock, after the merge, before the long checks): 11 of 11 tasks successful.
- **`integrate.sh` on a fresh Postgres on 54340, in four parts through the lock** (`urls_not_on_54340=0` each time; never the e2e step):
  - `install lint format copylint generated typecheck`: every step rc=0; `=== INTEGRATION PARTIAL (install lint format copylint generated typecheck)`.
  - `unit`: rc=0; `=== INTEGRATION PARTIAL (unit)`. Tests: domain 2,809, web 1,242 passed and 1 skipped (the OCR-language case without `OCR_LANG_PATH`, as on `main`), contracts 340, db 162, tokens 146, ui 107, voice 49, voice-agent 23, copy-lint 17; field (jest) 7 suites, 31 tests.
  - `security dbverify`: rc=0 both; `=== INTEGRATION PARTIAL (security dbverify)`. Security suite: db 66 files, 1,877 passed; domain 112 files, 1,530 passed; web 40 files, 491 passed. `db:verify`: "every migration is applied as it is on disk".
  - `audit build jsbudget gitleaks`: rc=0 each; `=== INTEGRATION PARTIAL (audit build jsbudget gitleaks)`. Audit: 3 moderate, all on the reviewed ignore list (the slice adds none); build 2 of 2 tasks with `.env` aside (put back); JavaScript budget: every page within its budget (65 pages); gitleaks: 31 commits scanned, no leaks found.
- **Fixed in the merge:** nothing broke; the only edits are the two citation lines in DATABASE and the regenerated data documents.
- **Left for the lead:** the e2e step (`field-phones.spec.ts`, which needs a fresh database) and the Linux baselines; if Q1 (0241, 0242) merges first, the slice takes `main` again and moves to 0243 to 0248.

### Integration prep after J2 (28-11-2026, cloud worktree of the lead's VM, the slice builder on Opus 5.5 at high)
- **Main taken in:** `origin/main` at `5f5ea1e7` (#300, J2 customer loans, migrations 0243 to 0246; with Q1 labels 0241 and 0242, #301 and #302); fetched again before the integration run, still `5f5ea1e7` (TC1 #303 not merged yet). Merge commit `80081756`, made as [slice-integration §5](../../runbooks/slice-integration.md#5-take-main-into-the-slice) says: `git merge --no-commit origin/main` from `55349d7e`, `pnpm install --offline --frozen-lockfile` (through the lock; lockfile up to date, `main` changed no lockfile or `package.json` since the merge base, nothing added), `renumber-migrations.mjs origin/main 55349d7e`, `pnpm db:generate` ("No schema changes, nothing to migrate"), `pnpm db:docs`.
- **Conflicts and how each was resolved:**
  - Lists, by `merge-union.py` and then read hunk by hand: `e2e/setup/seed.ts` (F1's phones import and seed step beside Q1's labels; a blank line put back between the two steps), `screens/audit.ts` (`appVersion` beside J2's eight loan fields), `db/src/schema/index.ts`, `enum-sync.test.ts` (F1's two pairs beside J2's six), the command registry (F1's two beside J2's seven), `agent-refusals.test.ts` (F1's two people-only inputs beside Q1's two).
  - `copy-lint.config.json` by `merge-copylint.py` (one hunk: F1's `biometric`, `signingOut` and main's loan and label buttons; 253 names, none twice).
  - `docs/05-database.md` by hand: `main`'s `files` row (with `label_sheet`) and F1's `feature_flags` row.
  - Generated files: the journal and snapshots 0241 to 0246 (restored to `main`'s by the script), `docs/data/data-dictionary.md` and `erd.md` (regenerated).
  - `apps/web/messages/en.json` merged with no marker; a JSON three-way merge from the merge base gives the same file, with no key changed on both sides.
- **Migrations' new numbers** (SQL verbatim from `55349d7e`, compared byte for byte; journal times after J2's `1795792882017`): 0241 → **0247** `f1_field_foundation`, 0242 → **0248** `f1_field_foundation_rls`, 0243 → **0249** `f1_refresh_grace`, 0244 → **0250** `f1_account_phones`, 0245 → **0251** `f1_account_phones_rls`, 0246 → **0252** `f1_enrolment_phones`. Journal entries 0 to 246, snapshots 0241 to 0246 and every SQL file of `main` equal `main`'s; the snapshot chain 0240 to 0252 links by `prevId`. DATABASE §6.1 and §6.10 now cite the new numbers (`mobile_devices` Built (0247), the retry window 0249; `feature_flags` Built (0247)); the reports above keep the numbers they were written with.
- **Redefinitions checked against `main`'s latest:**
  - The slice's six migrations create or replace no function; they call `app.set_updated_at()`, `app.user_id()`, `app.has_perm()`, `app.entity_ids()` and `app.user_roles_outside_request()`, none of which Q1 or J2 touches.
  - `app.platform_only_permissions()`: not redefined by F1; `main`'s latest stands (0222; Q1 and J2 leave it alone). `field.device.revoke` and `admin.flags.write` are person permissions.
  - `notifications_type_check` and `notification_preferences_type_check`: not redefined by F1; `main`'s latest stands (J2's 0245, with `loan_rejected`). F1 adds no notification type.
  - `files_purpose_check` and `app.file_purpose_grant()`: not redefined by F1; `main`'s latest stands (Q1's 0241 and 0242, with `label_sheet`). F1 adds no file purpose.
  - Q1's and J2's other definitions (`app.labels_for_print()`, `app.guard_customer_loan()`, `app.order_loan_gate()`, `app.notice_loan_owner()`, `sales_orders_id_entity_account_unique`) are outside the slice.
  - Check constraints: only the slice's own tables (`feature_flags_key_check`, the `mobile_devices` checks; `mobile_devices_revoked_reason_check` redefined in 0250 and 0252, the slice's own, both `NOT VALID`).
  - Foreign keys: only from the slice's own tables, to `users`, `principals` and `entities`, which Q1 and J2 do not alter; none to `customer_loans`, `lenders` or `sales_orders`.
- **Shared lists, a key used twice:** none. Checked: the registry (no command twice), `enum-sync` `PAIRS` keys, `audit.ts` `FIELD_KINDS`, `agent-refusals` (the `INPUTS` and `PEOPLE_ONLY_INPUTS` maps each hold a key once), the copy-lint button names, `en.json` (no duplicate key at any level), `testing/index.ts`, the journey users (14 keys, no e-mail twice). The journey fixtures' repeated phone numbers `98765 40051` to `40053` and the name `Mohan Lal Saini` are on both sides already (the quote and order snapshots), not from the merge.
- **Typecheck at once** (`pnpm typecheck` through the lock, after the merge, before the long checks): 11 of 11 tasks successful.
- **`integrate.sh` on a fresh Postgres on 54340, in four parts through the lock** (`urls_not_on_54340=0` each time; never the e2e step; logs `/home/user/shakti-wt/f1-r2-part*.log` and `f1-field-foundation-integrate-r2*.log.<step>`):
  - `install lint format copylint generated typecheck`: every step rc=0; `=== INTEGRATION PARTIAL (install lint format copylint generated typecheck)`.
  - `unit`: rc=0; `=== INTEGRATION PARTIAL (unit)`. Tests: domain 2,818, web 1,262 passed and 1 skipped (the OCR-language case without `OCR_LANG_PATH`, as on `main`), contracts 340, db 162, tokens 146, ui 107, voice 49, voice-agent 23, copy-lint 17; field (jest) 7 suites, 31 tests.
  - `security dbverify`: rc=0 both; `=== INTEGRATION PARTIAL (security dbverify)`. Security suite: db 67 files, 1,910 passed; domain 114 files, 1,570 passed; web 41 files, 496 passed. `db:verify`: "every migration is applied as it is on disk".
  - `audit build jsbudget gitleaks`, first run: `=== INTEGRATION FAILED`, on the JavaScript budget alone ("/price-master loads 247.1 kB of JavaScript (gzip), over its budget of 247 kB"; audit, build and gitleaks rc=0).
  - The same part after the fix below: rc=0 each; `=== INTEGRATION PARTIAL (audit build jsbudget gitleaks)`. Audit: 3 moderate, all on the reviewed ignore list; build 2 of 2 tasks with `.env` aside (put back); JavaScript budget: every page within its budget (66 pages); gitleaks: 33 commits scanned, no leaks found.
- **Fixed in the merge:**
  - `/price-master`'s budget, 247 → 248 kB (`27786731`). Cause: neither side alone is over. F1 measured 246.6 kB at the first prep; taking `main` added about 0.5 kB to every staff page (J2's Lenders menu entry in the shell, for which J2 raised `/catalogue` by 1 kB). The fix follows J2's own wording and amount. `js-budget.json` is one of the check files; F1's pull request changes check files already (`ci.yml`, `turbo.json`, `pnpm-workspace.yaml`), so it needs the owner's `checks-ok` either way.
  - Otherwise only the merged lists above, the three citation edits in DATABASE and the regenerated data documents.
- **Left for the lead:**
  - The e2e step (`field-phones.spec.ts`, on a fresh database) and the Linux baselines. J2's Lenders menu entry and Q1's screens are on `main` now, so the baselines F1 remakes for its Phones screen take them.
  - If TC1 (#303) or the calling-hours fix merges first and brings migrations, the slice takes `main` again and moves after them.
