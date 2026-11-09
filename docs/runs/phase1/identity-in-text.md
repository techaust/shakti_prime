# Aadhaar numbers in typed text (after Phase 1's slices)

| | |
|---|---|
| Branch | `fix/identity-in-text` on GitHub, from `main` at c4dc7669 (#227) |
| PC worktree | `identity-in-text`, slot 5: Postgres 54335 (container `shakti-pg-identity-in-text`), app 3035 |
| Runs on | PC (owner, 09-11-2026) |
| Tier | A (identity data, and the command runner every write passes through): build and review Opus 5.5 high |
| Usage | build Opus high from 5h 2 (09-11-2026) |
| State | building |
| Next step | the builder builds the brief |

## Brief
The owner's decision of 09-11-2026 ([DECISIONS](../../11-decisions.md)): an Aadhaar number someone types into a note or any other free-text field is masked by the command that stores it, keeping only its last four digits, with the finder the imports, the logs and the audit trail already share. Today SECURITY §5 masks vault files, import files, the logs and the audit trail, but a number typed into `crm.note.add`'s `body`, a lead's notes, a cancel reason or an address is stored as typed. Design: [SECURITY §5](../../07-security.md#5-data-protection-dpdp-act-2023-rules-2025) (Aadhaar), [AGENTS §5](../../../AGENTS.md#5-domain-commands) (commands).

1. **The input masker** (`packages/domain/src/privacy/`, a new file with its unit tests): a pure function that walks a command's parsed input (strings in objects and arrays, at any depth) and returns the input with every Aadhaar number in each string masked to its last four digits, and how many it masked. It uses `maskIdentityText()` (`packages/domain/src/imports/identity-columns.ts`), or the finder under it (`findPersonalNumbers()` in `privacy/number-shapes.ts`) if that keeps one source better: the same reading of a number as the imports, the logs and the audit trail (twelve digits, the first 2 to 9, the Verhoeff check, any grouping, any script's digits, a phone after `+` kept). Masking twice changes nothing. Non-string values (numbers, booleans, `Date`s, null) pass through untouched.
2. **In the runner, for every command** (`packages/domain/src/command/run-command.ts`): apply the masker to `parsed.data` right after the input schema's `safeParse` (about line 306) and before the idempotency hash (about line 337), the `peopleOnly` guard's use of the input and the handler, so the stored row, the audit trail, the outbox event, the idempotency record and a nested command all see the masked input. A replay of the same key with the same unmasked input must still match its first run (both hash the masked input). No per-command code: every command of the registry gets it, people's and agents' alike, imports and webhooks included (their own masking stays; masking again changes nothing).
3. **Exemptions, declared:** `defineCommand` (`packages/domain/src/command/define-command.ts`) gains an optional list of input paths that hold another long number by design and are never masked, each with its reason in a comment. Find them by reading every command's input schema (the registry, `src/command/registry.ts`): at least `org.entity.update`'s bank `accountNumber`, which is sealed by the `FieldCipher` and must stay whole. Check also any field of serials, document numbers, HSN codes, IFSC, GSTIN, PAN, UPI, vendor or Tally references and phone numbers: list one as exempt only if the masker would change a valid value of it (a test proves it either way). A registry test fails when an exemption names a path the command's input schema does not have.
4. **Values that must never change** (unit tests on the masker): UUIDs (an id whose last group is twelve digits, `…-234567890124`, with a valid check digit), idempotency keys, money strings, dates and timestamps, E.164 phones (`+919876543210`), a GSTIN, a PAN, an IFSC, a twelve-digit number with an invalid check digit, and an email address. A valid Aadhaar number written plain, grouped `2345 6789 0124`, with hyphens, in Devanagari digits and inside a sentence is masked to `XXXX XXXX 0124` (separators kept) in each case.
5. **Tests on real Postgres** (`packages/domain/tests`, or `packages/db/tests/security` if it reads better there): `crm.note.add` with an Aadhaar number in its body stores only the last four digits, in the activity row, the audit row and the outbox payload; a command with a nested object or array of strings (find one in the registry, a lead or an order) masks inside it; `org.entity.update` keeps a bank account number that happens to be a valid Aadhaar shape whole (sealed, then opened, equal); an idempotent replay with the unmasked input succeeds and returns the first response. The denied and wrong-company tests of the commands are unchanged.
6. **Documents:** SECURITY §5's Aadhaar list gains typed text (what is masked, where, the exemptions and why); AGENTS §5 names the exemption list beside `auditFields` and `peopleOnly`; the `add-command` skill's checklist (`.claude/skills/add-command/SKILL.md`) asks whether a new input field holds a long number by design. No change-log wording ([CLAUDE.md](../../../CLAUDE.md), approved documents).

No migration, no new table, no screen and no new copy: a saved note shows the masked number, so the person sees it was hidden. Do not change the imports' own masking, the logs' scrubber, the model masker or the OCR step. Files owned: `packages/domain/src/privacy/` (the new file), `src/command/run-command.ts`, `src/command/define-command.ts`, the commands' exemption lines, the new tests, the three documents above.

Stop and report (commit first) if: a command's input turns out to need a value masked that the finder does not read as Aadhaar, or not masked where no exemption fits; a test outside this slice's files fails because of the masking; the runner change needs a change to the idempotency store or a migration; or the security suite needs a fresh database.

Done when: the checks of AGENTS §10 pass on the slot (unit tests, typecheck, the whole-repository lint as the final check, copy lint, format); the security suite passes on the slot's Postgres (`pnpm test:security`); the counts of each suite before and after are in the report.

## Report

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
- No migration and no screen, so no renumbering and no baselines.
- After the merge: a read-only count on dev and staging of stored text with an Aadhaar-shaped number (notes, activities, reasons, addresses); anything found is changed only with the owner's yes.
