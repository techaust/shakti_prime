# E1 Channels and dial rules (wave 1)

| | |
|---|---|
| Branch | `feat/e1-channels` on GitHub, from `main` at 008066b7 |
| PC worktree | none: built in a cloud session of its own (Postgres 54322, app 3000) |
| Runs on | a cloud session, the lead on the PC (owner, 13-11-2026, for this day) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)) |
| Usage | build Opus 5.5 high, 5-hour window 11 % at the start |
| State | brief |
| Next step | build to the early check |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase2.md` §5.2](../../03-roadmap-appendix/phase2.md#52-e1-channels-and-dial-rules), §2 (question 13: off on production), §3, §4, §11, §12 and §14.
- BLUEPRINT §7.7 (DLT 140 and 160 series, TRAI hours, DND, consent); PRD TEL-04 and CRM-10; SECURITY §3.2; DATABASE §5 (the planned `entity_channels`); `docs/04-architecture-appendix/exotel.md` and `calling.md`.
- What exists: `checkDial` and the telecom rules in `packages/domain/src/telecom`; `contact_phones.is_dnd` and `dnd_checked_at`; consents and their withdrawal; the Cold Caller (`/calling`) and Converting workspaces; Settings › Companies; `WORKSHOP_DEFAULTS.calling`; the ports folder `packages/domain/src/ports`.
- Skills: `add-table`, `add-command`.

Build, in this order:
1. **`entity_channels`** as §5.2 says, with RLS by company, the testing lists, a fixture row per company and the role × company matrix (AGENTS §6); `org.channel.set` and `org.channel.archive` (`admin.entities.write:all`, audited, denied, wrong-company and happy-path tests).
2. **`app.dial_facts()`**, answering only what `checkDial` needs; its security tests.
3. **`call-purpose.ts`** (pure, unit-tested) and `checkDial` choosing the 160 series for a consented service call and the 140 series otherwise, refusing a promotional call to a DND number and any call outside 09:00 to 21:00 IST, listing every broken rule.
4. **DND:** the `DndRegistry` port with a fixture adapter; `crm.phone.dnd_record` through the port as the platform (a platform-only grant if it needs one, in `SYSTEM_MATRIX`, `PLATFORM_ONLY_PERMISSIONS` and a new `app.platform_only_permissions()` that keeps every key of `main`'s latest, migration 0142); `WORKSHOP_DEFAULTS.calling.dndFreshDays` (7); a stale check refreshed at the dial, an unreachable registry refusing only the promotional dial (`dnd_unknown`).
5. **Screens:** Settings › Companies › Channels (each company's numbers, whether verified); in the Cold Caller and Converting workspaces, the number a call would go out on, why, and any refusal reason, in plain words from `en.json` (no Dial key: T3 adds it). Journeys with axe; the JavaScript budget.
6. **Tests:** every case of TEL-04's two criteria; a contact who withdrew call consent cannot be dialled by any path; a stale DND check; the security suite proving `entity_channels` per role and company.
7. **Documents:** DATABASE, SECURITY §3.2, the telecom document, design §5.2 "Built (E1)", `pnpm db:docs`, `machines:docs` if a machine changes.

Files owned: everything above. Shared registration points (one line each, merged by the lead): the permission catalogue and seed, `en.json`, `nav.ts`, the testing lists, `WORKSHOP_DEFAULTS`. P5, V1 and K2 build beside you: never touch `webhook_inbox`, the webhook routes, `apps/web/src/integrations/voice` or the Playbook.

**Early check (Tier A):** once the table, the commands, `app.dial_facts()`, the purpose rule, `checkDial` and the DND port are committed with their tests, write a short report in this file, commit it with the subject `report: e1-channels early check`, push and stop. The lead reads that diff and starts you again for the screens.

Done when: AGENTS §10 holds on the branch; the acceptance lines of §5.2 pass; `pnpm test:security` passes on the local Postgres.

Not in E1: the Dial key, Exotel calls and recordings (T3); the real DND scrub source and the DLT numbers (final phase); WhatsApp sending (W1). Nothing the client must give is invented: channel numbers are entered on the screen, tests use clearly synthetic numbers.

## Report

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
- Migrations are numbered after `main`'s last at merge; if E1 redefines `app.platform_only_permissions()`, keep every key P5 or K2 adds.
