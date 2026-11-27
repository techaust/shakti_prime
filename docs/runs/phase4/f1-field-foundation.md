# F1 Field app foundation and mobile sign-in (Phase 4, wave 1)

| | |
|---|---|
| Branch | `feat/f1-field-foundation` on GitHub, from `main` after the approved design (#295), with the lead's commit adding `apps/field/package.json` and the lockfile |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): authentication, tokens, device revocation |
| Usage | briefed 27-11-2026; built by the slice builder on Opus 5.5 at high effort (27-11-2026, early check and done) |
| State | done |
| Next step | review, then integration (Linux baselines of `field-phones.spec.ts` on a fresh database) |

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

## Review

## Integration
