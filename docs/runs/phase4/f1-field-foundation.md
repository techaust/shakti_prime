# F1 Field app foundation and mobile sign-in (Phase 4, wave 1)

| | |
|---|---|
| Branch | `feat/f1-field-foundation` on GitHub, from `main` after the approved design (#295), with the lead's commit adding `apps/field/package.json` and the lockfile |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): authentication, tokens, device revocation |
| Usage | briefed 27-11-2026 |
| State | briefed |
| Next step | the builder |

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

## Review

## Integration
