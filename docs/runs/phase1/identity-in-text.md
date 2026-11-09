# Aadhaar numbers in typed text (after Phase 1's slices)

| | |
|---|---|
| Branch | `fix/identity-in-text` on GitHub, from `main` at c4dc7669 (#227) |
| PC worktree | `identity-in-text`, slot 5: Postgres 54335 (container `shakti-pg-identity-in-text`), app 3035 |
| Runs on | PC (owner, 09-11-2026) |
| Tier | A (identity data, and the command runner every write passes through): build and review Opus 5.5 high |
| Usage | build Opus high from 5h 2 (09-11-2026) |
| State | built, waiting for review |
| Next step | the lead recreates the slot's database and runs the whole security suite once (set-price needs a fresh one, see the Report), then the review |

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

### 09-11-2026, PC (slot 5, Postgres 54335)

**Built.** Skills loaded: `add-command`.
- `packages/domain/src/privacy/input-masking.ts` (new): `maskTypedIdentity(text)` and `maskInputIdentity(input, unmaskedFields)`. It walks plain objects and arrays at any depth and masks strings only; numbers, booleans, `Date`s, bigints, null and class instances pass through. An unchanged object or array comes back as the same reference, a key named `__proto__` stays an own key, and a string with fewer than twelve digits is skipped before the finder reads it. A number is what `findPersonalNumbers()` reads as Aadhaar-shaped, and it is masked when some run of its consecutive digit groups, the first starting 2 to 9, holds exactly twelve digits with a valid Verhoeff check. The whole run is then masked with `lastFourOnly()`, as the imports mask it. A decimal amount (`\d+\.\d{1,2}`) is never masked. The function answers the count of numbers masked.
- `packages/domain/src/privacy/number-shapes.ts`: `lastFourOnly()` moved here from `imports/identity-columns.ts`, unchanged, so the imports and the runner share one helper. `identity-columns.ts` now imports it; nothing in the imports' masking changed.
- `packages/domain/src/command/run-command.ts`: `data = maskInputIdentity(parsed.data, command.unmaskedFields).value` right after `safeParse`. Every later use reads `data`: the people-only and permission guards, the stage tags (refusal rows), the idempotency hash and replay, the handler and `auditedInput`. A nested `ctx.run` re-parses and masks its own input under its own exemptions.
- `packages/domain/src/command/execute.ts` (the lead's point 1): `refusedInput()` now masks input the runner never reached, such as a scope refused before the runner or a failed commit, under the command's exemptions. Before, that input went only through the scrubber.
- `packages/domain/src/command/define-command.ts`: `unmaskedFields?: readonly string[]`. Entries are dot paths of object keys; arrays are passed through, and each entry covers everything under it.
- Exemption lines, each with its reason in a comment: `org.entity.update` (`bankDetails.accountNumber`, `upiId`); `catalogue.item.create`/`update` and `catalogue.kit.create`/`update` (`sku`); `files.upload.begin` and `files.document.record` (`sha256`); `files.upload.complete` and `files.file.mark_ready` (`stored.sha256`); `admin.role.permissions.set` (`expectedVersion`); `crm.lead.create` and `crm.enquiry.take` (`referralCode`); `crm.referral_partner.set`/`create` (`code`); `crm.commission_rule.set` (`amount`); `crm.contact.update` and `admin.user.invite` (`email`); `notifications.push.subscribe` (`endpoint`, `keys`); `notifications.push.unsubscribe` (`endpoint`); `imports.job.create` (`rows`).
- Documents: SECURITY §5 has a new **Typed text** item in the Aadhaar list. AGENTS §5 has an `unmaskedFields` bullet beside the other declarations, and "What the runner does" now says the input is masked. The `add-command` skill gained a checklist line.

**Exemption decisions** (the lead's point 2: a field is exempt only when its own schema refuses free text; `unmasked-fields.test.ts` checks this for every entry against `Aadhaar 2345 6789 0124 near the well`):
- Kept exempt, because the schema refuses free text and a valid value would be masked:
  - the bank account number: digits only, 9 to 18, sealed whole;
  - the UPI id: a no-space `name@handle`, and `919876543216@okaxis` is valid;
  - the SKU: capitals, digits and `-_/.`, and a 12-digit barcode is valid;
  - the SHA-256 and grant-version fields: 64 hex characters;
  - the referral codes: 4 to 12 letters or digits, matched whole;
  - the commission amount: `\d{1,12}(\.\d{1,2})?`, so twelve whole digits are valid;
  - the emails: the email shape, and `919876543216@gmail.com` is valid;
  - the push endpoint (an https address of a known push service in canonical form) and its base64url keys.
- Kept exempt although free text: `imports.job.create` `rows`. The command masks every cell itself (`maskLongNumberCells()`), and that masking is stricter, since it hides every Aadhaar-shaped number whether or not its check digit is valid. Its one exception is 91 and a mobile number in a phone column, which the import keeps as a phone on purpose. A second masking without the column's knowledge would hide about one in ten such phones. The test names this as the only free-text exemption.
- Removed as free text, now masked:
  - `sales.dealer_outstanding.record` `oldestUnpaidInvoiceNo` (free text up to 60 characters): an all-digit invoice number whose twelve digits pass the check keeps only its last four. This is an accepted cost, stated in SECURITY §5.
  - `notifications.push.record` `gone` and `delivered` (`z.string().max(1000)`): only the workers principal calls it, with addresses read from the database. An address holding a twelve-digit run that passes the check would no longer match its stored row. This is the same accepted cost; browser push tokens are base64, so such a run is very unlikely.
- Checked and not exempt, because a valid value comes through unchanged (`KEPT_EXAMPLES`): GSTIN, IFSC, PIN, HSN; money with two decimals, `234567890124.00` included, in `price`, `creditLimit` and `outstanding`; `flowLph`; E.164 and typed phones (`PhoneInputSchema` stores `+91…`); storage keys as `uploadKey()` makes them, with a UUID whose last group is a valid Aadhaar number; ISO timestamps with an offset or microseconds; dates.
- Agent proposals (`agents.run.record` `proposal.input`) are masked as free text. Today they target only `crm.duplicate.suggest` and `crm.opportunity.assign`, which have no exempt field.

**Tests added (102):**
- Unit, 93: `privacy/input-masking.test.ts` (41), `command/unmasked-fields.test.ts` (48), `command/run-command-masking.test.ts` (4: the handler and audit see the masked input; an exempt field is masked in a nested command that does not exempt it; the key hashes the masked input, so a repeat as typed replays; a refusal keeps the masked input).
- Postgres, 6: `tests/commands/identity-in-text.test.ts`, covering:
  - `crm.note.add`: the activity row, the audit row and the outbox; a refusal of an agent (guard stage); a refusal of a company outside the caller's access (before the runner); an idempotent replay with the unmasked input, a masked repeat that also replays, a mismatch, one note only, and an idempotency record holding no digits;
  - `crm.lead.create` with nested `contact.name` and `site.village`: the stored rows, the events, the audit rows and the timeline;
  - `org.entity.update`: a bank account number `234567890124` sealed and then opened whole, the UPI id kept, the branch text masked and the audit row showing `****0124`.
- No existing test was changed.

**Checks:**
- Security suite, before (the branch at the start, slot database freshly migrated): db 1,272, domain 1,041, web 342, all passed.
- Security suite, after, on the same database:
  - db 1,272 passed;
  - domain 1,047: 1,039 passed and 8 skipped, because `set-price.test.ts` failed its `beforeAll` with `price_lists_no_overlap`;
  - web, run alone, 342 passed.
- The set-price failure comes from running the suite a second time on the same database, not from this slice: the first run's web suite (`demo-data.test.ts`) left approved retail, dealer and commercial lists effective 09-11-2026 and never archived. Set-price's `beforeAll` inserts its commercial list directly in SQL, so masking never runs there. On a fresh database the domain suite runs before the web suite, which is why the first run passed. **The whole suite needs a fresh slot database to show all 1,047 domain tests passing.**
- Unit tests (`pnpm test`): domain 2,344 (2,251 before plus the 93 new), contracts 182, db 146, ui 107, tokens 146, copy-lint 17, web 969 passed and 1 skipped (no web file changed). 8 of 8 tasks passed.
- Typecheck of the whole repository: 8 of 8 tasks passed. Copy lint is clean. `pnpm format:check` is clean. The final whole-repository `pnpm lint` passed with no warnings.
- The document link check reports the 2 broken links already on `main` (`.claude/settings.local.json`), none new.
- No list or search was added, so no `EXPLAIN` was needed. No migration, no table, no screen and no copy.

**Decisions the brief did not settle:**
1. The masker requires the Verhoeff check, so a twelve-digit number with an invalid check digit is kept (brief §4). The imports mask such a number anyway.
2. A run with extra digit groups (`Plot 12, 2345 6789 0124`, or a phone joined by a comma) is masked whole when any run of twelve digits inside it is valid. This follows the imports and keeps a number written beside another from leaking.
3. A decimal amount is never masked, so the money fields with two decimals need no exemption.
4. Devanagari and other scripts keep their own digits in the last four (`XXXX XXXX ०१२४`), as `lastFourOnly()` writes them for the imports.
5. Object keys are not masked, only values.
6. No key-name rule for phones (the imports' `namesPhone`), because every phone input is E.164 after parsing, so a phone reaches the masker after a `+`.
7. `execute.ts` was changed outside the files the brief listed, at the lead's request, so that a refusal row never holds unmasked input.

**Unfinished or uncertain:**
- The whole security suite on a fresh database (above).
- The integration note's read-only count of stored Aadhaar-shaped text on dev and staging is still to do after the merge.

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
- No migration and no screen, so no renumbering and no baselines.
- After the merge: a read-only count on dev and staging of stored text with an Aadhaar-shaped number (notes, activities, reasons, addresses); anything found is changed only with the owner's yes.
