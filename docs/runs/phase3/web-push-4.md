# web-push 4: the major bump of Dependabot #255

| | |
|---|---|
| Branch | `chore/web-push-4` on GitHub, from `main` at 334a6d0b |
| Runs on | a cloud session of its own; the lead on the PC reviews and integrates (owner, 23-11-2026, for this day) |
| Tier | B ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): the notifications worker's push sender |
| Usage | 5-hour window 0 % at 17:40 UTC when briefed; builder on Opus 5.5 at high effort from start to done (recorded at start and at the report, 23-11-2026) |
| State | built; the notifications journey still to run on the PC |
| Next step | the lead's review, and the notifications journey on the PC |

## Brief
`web-push` 4.0.0 (published 06-11-2026, past the two-week rule) is a major: the package moved to ESM and to class syntax. The merge workflow never merges a Dependabot major, so the bump comes in this branch, and Dependabot closes #255 itself once it merges.

1. In `apps/web/package.json`, `web-push` goes to `^4.0.0`. Read `node_modules/web-push`'s own types and README after the install: if 4.0.0 ships its own types, remove `@types/web-push`; if it does not, keep it at the newest release that matches. Update `pnpm-lock.yaml` with `pnpm install` (this brief names this lockfile edit; nothing else changes in it).
2. `apps/web/src/notifications/push.ts` loads the package with `await import('web-push')` on first use and calls `sendNotification` with `vapidDetails`, `TTL`, `timeout` and `urgency`. Check each against 4.0.0: the export shape under ESM (a default export, named exports or both), the option names, and how a failed push reports its HTTP status (`statusCode` on the thrown error decides `gone` for 404 and 410). Change the code only as the new version needs, keeping the lazy load.
3. `apps/web/src/notifications/push.test.ts` mocks the module; make the mock match 4.0.0's export shape, and add a test that the sender reads the status from the error 4.0.0 throws (one of 404 or 410 gives `gone`, 500 gives `failed`).
4. `pnpm build` must still pass with no `.env`, and the route modules must not load `web-push` at import time.

Files owned: `apps/web/package.json` (the two lines above only), `pnpm-lock.yaml`, `apps/web/src/notifications/push.ts`, `apps/web/src/notifications/push.test.ts`.

Do not touch: anything else; no other dependency moves.

Review checklist (check before your report): the push still loads only on first use; 404 and 410 still mark the address gone; no other package changed in the lockfile beyond `web-push`'s own tree; `pnpm build` passes.

## How this slice runs
- **Your role:** you are this slice's builder, not the lead. Read `.claude/agents/slice-builder.md` first and follow it as your rules (its **Cloud** lines), with this file as your brief. `CLAUDE.md` calls every session the lead: in this session that does not apply. Do not run the `start-session` or `end-session` skills, open or merge a pull request, push to `main`, touch any hosted service or GitHub workflow, delete a branch, or force-push.
- **Branch:** `chore/web-push-4` is on GitHub with this file. Start with `git fetch origin && git switch chore/web-push-4` and work in the checkout itself (one slice in this VM); the session hook starts Postgres on 54322 (start every shell command with `. tools/integration/lib.sh &&`).
- **Push:** commit as you go and push your branch after every commit, at least every 10 minutes; a reclaimed VM loses everything unpushed.
- **Your checks, in the VM, before your report:** `pnpm install --frozen-lockfile` passes on your lockfile; `pnpm typecheck`; `pnpm exec eslint --max-warnings 0 apps/web/src/notifications`; `pnpm --filter web test`; `pnpm audit --prod` shows no new advisory; `pnpm build`; then the notifications journeys (`pnpm --filter web e2e:seed && pnpm --filter web exec playwright test` with the specs under `apps/web/e2e` that cover browser alerts, found with `grep -ril push apps/web/e2e`).
- **Reporting:** the lead watches your branch from the owner's PC and reads nothing else of this session. Write your report into this file's Report section (under a heading with the date and "cloud session"), commit it with the subject `report: web-push-4 <stage>` and push. The stages are `done`, `fixes` and `blocked`. That commit subject is how the lead knows you have stopped. After `report: web-push-4 done` stop: the lead reviews the branch and may send findings to this session for one fix round, which ends with `report: web-push-4 fixes`.
- **Questions:** the owner does not read this session. For a minor gap take the reasonable call, record it under "Assumptions" in your report and continue. Only when no reasonable call exists (the new version cannot do what the sender needs, a refused tool), push `report: web-push-4 blocked` with the question and stop.
- **Never:** a live push service or hosted call in a test; a `package.json` script change or any other package.
- **Usage line:** record your model and effort at the start and end in the header's Usage line (the owner runs this session on Opus 5.5 at high).

## Report

### 23-11-2026, cloud session
**Result:** the bump is built and every check passes in the VM except the notifications journey, which could not sign in here: the environment's network policy refuses `challenges.cloudflare.com` (the Turnstile check on the sign-in screen), so every role's sign-in in `auth.setup.ts` stopped at "We couldn't check that you're a person". The lead runs that journey on the PC.

**What 4.0.0 changed, and what the sender needed**
- 4.0.0 is `"type": "module"` with named exports only (`sendNotification`, `WebPushError`, `setVapidDetails`, `generateVAPIDKeys`, `encrypt`, `getVapidHeaders`, `generateRequestDetails`, `setGCMAPIKey`, `supportedContentEncodings`) and no default export. `push.ts` already reads `webpush.sendNotification` from the module namespace of `await import('web-push')`, so it works unchanged.
- The option names are the same (`vapidDetails`, `TTL`, `timeout`, `urgency`, among the ten keys `generateRequestDetails` accepts), and `urgency: 'normal'` is still one of the four values.
- A response outside 2xx still rejects with `new WebPushError(message, statusCode, headers, body, endpoint)`, so `statusCode` on the error still decides `gone` (404, 410). A timeout is a plain `Error('Socket timeout')` with no status, which the sender reads as `failed`.
- `push.ts` is therefore unchanged: the brief allows a change only where 4.0.0 needs one.

**Files**
- `apps/web/package.json`: `web-push` `^3.6.7` to `^4.0.0`. 4.0.0 ships no types (no `types` field and no `.d.ts`), so `@types/web-push` stays at `^3.6.4`, its newest release (resolves to 3.6.4). Those types declare the same named exports and `WebPushError.statusCode`, and the whole repository typechecks.
- `pnpm-lock.yaml`: only `web-push`'s own tree moved: `web-push` 4.0.0, `http_ece` 1.2.0 to 1.2.1, `https-proxy-agent` 7.0.6 to 9.1.0, `agent-base` 7.1.4 to 9.0.0, the new `proxy-agent-negotiate` 1.1.0 (its optional `kerberos` peer is not installed), and `minimist` dropped from web-push's dependencies (it stays in the lockfile for its other users). `https-proxy-agent` and `agent-base` had no other user. The two moved agents need Node 20 or later; the repository runs Node 24.
- `apps/web/src/notifications/push.test.ts`: the mock keeps 4.0.0's shape (named exports, no default) and rejects with the package's own `WebPushError` (from `importOriginal`), built as 4.0.0's sender builds it.

**Tests** (`push.test.ts`, 4 to 6 cases)
- New: `loads web-push only on the first send, not when the module is imported`: the mock's factory has not run after `./push` is imported and `pushSender()` is built, and has run after the first send.
- New: `reads the status from web-push 4.0.0's own WebPushError`: 410 and 404 give `gone`, 500 gives `failed`, and a plain `Socket timeout` error gives `failed`.
- Changed: the 404/410/500/429 case now throws the real `WebPushError` instead of an `Error` with `statusCode` added by hand.
- Mutation check: with the sender reading `status` instead of `statusCode`, both status tests fail (2 failed, 4 passed); restored.

**Checks in the VM**
- `pnpm install --frozen-lockfile`: "Lockfile is up to date, resolution step is skipped".
- `pnpm typecheck`: 10 successful, 10 total.
- `pnpm exec eslint --max-warnings 0 apps/web/src/notifications`: no findings. Prettier: clean.
- `pnpm --filter web test`: 163 files passed; 1208 tests passed, 1 skipped.
- `pnpm audit --prod`: "3 ignored: 3 moderate", the advisories already listed in `pnpm-workspace.yaml`'s `auditConfig`; nothing new.
- `pnpm build` with `.env` moved aside: passed (`web:build` cache miss, so it really built). In `.next/server`, the web-push code (`chunks/node_modules__pnpm_1ci1lmac4shsx._.js`) is referenced only from Turbopack's async loader (`s.v(e => Promise.all([...].map(e => s.l(e))).then(...))`), so no route module loads it at import time.
- `pnpm --filter web e2e:seed`: passed on a fresh database.
- `playwright test notifications.spec.ts`: **not verified.** The setup project's sign-ins failed as above (refused host), so the spec never ran. `grep -ril push apps/web/e2e` finds only `notifications.spec.ts` covering browser alerts; the other hits are `Array.push`, `git push` wording and voice push-to-talk.

**Review checklist**
- The push still loads only on first use: yes (the new test, and the build's async loader).
- 404 and 410 still mark the address gone: yes (both status tests, against 4.0.0's `WebPushError`).
- No other package changed in the lockfile beyond `web-push`'s own tree: yes (listed above).
- `pnpm build` passes: yes, with no `.env`.

**Assumptions and environment notes**
- The session hook's Postgres did not start (Docker Hub answered 429). `docker compose up -d --wait` worked when I ran it again. I later recreated that same container (`docker compose down -v`, then up) because a seed run had stopped halfway: the first seed run failed at the quotes because the journeys' Chromium build (`chromium_headless_shell-1248`) was missing. The VM lacked the pinned Playwright image, so the hook's `ensure_playwright_browsers` had nothing to copy from. I pulled that pinned image (`mcr.microsoft.com/playwright:v1.64.1-noble@sha256:7852dc5a…`) and re-ran the helper, which copied `chromium-1248` and `chromium_headless_shell-1248` into `/opt/pw-browsers`. No package or lockfile change came from this.
- The cloud environment's network settings need `challenges.cloudflare.com` allowed, as hybrid.md's host list already says, before a cloud session can run journeys. The owner changes that under the environment's Network access.
- Skills loaded: none. The brief names none, and this slice has no command, table or screen.

