# ADR 0012 — Expo with WatermelonDB for the offline field app

**Status:** Proposed (2026-09-27; confirmed when the Phase 3 field app build starts, with the mobile token work of week 3 slice 1b part 3) · **Blueprint:** §5, §8.7, §16 · **Architecture:** §10 · **API:** §3.1, §3.2 · **Design:** docs/design/backend-weeks-3-5.md §2.4 · **ADR:** 0003, 0006

## Context
Field engineers survey sites, install pumps and rooftop systems, record QC, material, attendance and expenses in villages with weak or no signal, sometimes for several days. The app must work fully offline for at least **5 days**, keep photos and signatures safe until they upload, and never let two people's edits silently overwrite each other. The team is one developer working in TypeScript and React; only Android is needed.

## Decision
**An Expo (React Native) app with a development build, and WatermelonDB on expo-sqlite as the offline store, syncing through `/api/v1/sync/pull` and `/api/v1/sync/push`.**

- **Expo development build** (not Expo Go), so native modules for SQLite, background uploads, camera, location and FCM are available; built and released with EAS Build and EAS Update with staged rollouts. NativeWind styles come from `packages/tokens`.
- **WatermelonDB on expo-sqlite** holds the engineer's working set: schedule, jobs, surveys, checklists, QC, material, attendance, expenses and reference data. Records created offline get client UUIDv7 ids (ADR 0006), so a retried upload names the same record.
- **Pull:** `GET /sync/pull?since=<cursor>` returns upserts and removals per collection with an opaque server cursor (`SyncPullResponse`); a full pull runs when the cursor has expired.
- **Push:** `POST /sync/push` sends the commands recorded offline, each with its own idempotency key (`SyncPushRequest`); the server applies them in order through the command layer. Status transitions are server-authoritative, survey answers merge per field by `clientTime`, stock and expense commands are idempotent.
- **Conflicts** come back per command (`conflict` with the server's record, `held` for later commands on the same record) and are shown on a conflict review screen; nothing is discarded without the engineer seeing it.
- **Files** (photos, receipts, signatures, selfies) are compressed on the device and uploaded in the background with pre-signed URLs (`/files/presign`, `/files/:id/complete`); a record references the file id and shows it as pending until the upload lands.
- **Version gate:** `GET /me` returns `minimumAppVersion`; below it the app blocks new work and asks for the update, and sync answers `app_update_required`, so an old client never writes with a retired contract.
- **Sign-in:** 15-minute access tokens and rotating 30-day refresh tokens bound to the device (`/auth/mobile/*`, ADR 0003); the refresh window covers the 5-day offline target, and a device can be revoked from the web.

## Consequences
- The whole stack stays TypeScript; `@shakti/contracts` validates sync payloads on both ends.
- WatermelonDB's lazy loading keeps large working sets fast on low-end Android phones; its schema migrations ship with each app release and are tested against the previous version's database.
- The sync protocol is ours to maintain: collection DTOs and the per-field merge rules are contracted per module as each Phase 3 screen is built.
- An engineer offline longer than the refresh window signs in again before pushing; local data stays on the device until then.
- A second developer for the Android app (blueprint §18, risk 1) can work against the contracts without touching the web app.
