# web-push 4: the major bump of Dependabot #255

| | |
|---|---|
| Branch | `chore/web-push-4` on GitHub, from `main` at 334a6d0b |
| Runs on | a cloud session of its own; the lead on the PC reviews and integrates (owner, 23-11-2026, for this day) |
| Tier | B ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): the notifications worker's push sender |
| Usage | 5-hour window 0 % at 17:40 UTC when briefed; builder on Opus 5.5 at high effort from start to done |
| State | briefed |
| Next step | the builder's report |

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
