# Demo data for the screen review (follow-up)

| | |
|---|---|
| Branch | `feat/demo-data` on GitHub |
| PC worktree | `demo-data`, slot: Postgres 54342, app 3042 |
| Runs on | PC |
| Tier | B ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)) |
| Usage | build Opus medium 1→, 5h 7→ |
| State | built, waiting for review |
| Next step | the lead reviews; the customer archive gap needs a decision |

## Brief
Design: [wireframe-review §1a](../../13-client-packs/wireframe-review.md#1a-before-the-sessions) and the open follow-up "The demo data loader for the screen review" in [STATUS](../../10-status.md#open-follow-ups).

Build a loader that puts a small, clearly labelled demo data set and one account per role on the review system (staging), and takes it all off again after the reviews.

1. **One script, two actions:** `apps/web/scripts/demo-data.ts`, run as `pnpm --filter web exec tsx scripts/demo-data.ts load` and `... remove`. Do not add an entry to any `package.json` `scripts` (that changes the checks and needs the owner's label). It reads the database of `.env` as the other scripts do.
2. **Where it may run:** a local database (`BOS_ENVIRONMENT=local` or a localhost/127.0.0.1 address) or the staging project only. It refuses any other target, and above all production (project ref `ifnoytyhnedgiyhxxhhu`, and any `BOS_ENVIRONMENT=production`), before it opens a connection that writes. A unit test proves the refusal.
3. **Writes only through domain commands** (`executeCommand()` / the command runner, CLAUDE.md "One command layer"), as a principal the database already has (the first Executive, found by the script; it stops with a plain message when there is none). People are invited through the same path as `scripts/invite-executive.ts` / Admin › Team members, so each prints a set-password link and no password is ever made up or printed. Where no command exists for something the set needs, leave it out and say so in the report; never write to a table directly.
4. **The set** (§1a): items and kits with prices on the Retail, Dealer and Commercial lists; a few customers with leads in more than one company, a site, a note on the timeline and a consent; it includes the customer Bhanwar Lal Jat. Every record a person can see is labelled as demo data (for example a name that ends in "(demo)" and item codes that start `DEMO-`), so no reviewer can take it for the client's. Prices and tax come from the Price Master and the tax engine as for any quote; the script never computes a price or a tax figure. Amounts and names are invented and plainly demo.
5. **One account per role:** a person for each of the eleven roles (in the company the role needs), with an address the owner can change by a flag (`--email-domain`), each printed with its role and set-password link.
6. **Idempotent:** `load` run twice changes nothing the second time; it finds its own records by their demo labels or a marker it records.
7. **`remove`:** takes off everything `load` made, through commands: archives or withdraws what the domain keeps (append-only ledgers, audit rows and price history stay, as the architecture requires), and closes every demo account (signs them out and switches them off). After `remove`, no demo record shows in any list a reviewer opens. The report names what stays in the append-only tables.
8. **Docs:** the §1a line of `docs/13-client-packs/wireframe-review.md` names the two commands, in one targeted line (docs are edited by hand, single lines).

Files owned: `apps/web/scripts/demo-data.ts` and its tests, the one line of `wireframe-review.md`, this run file. Do not change migrations, the schema, commands' behaviour, product copy (`en.json`) or any check.

Done when, beyond AGENTS §10: `load` twice then `remove` on the local Postgres passes in a test (each list a reviewer opens is empty of demo records after `remove`), the production refusal is tested, typecheck and the folder lint pass, and the web suite passes. No journeys or screenshots are needed. Commit at each finished layer and at least every 20 minutes.

## Report

### 20-10-2026, PC (worktree `demo-data`, Postgres 54342)
**Built**
- `apps/web/scripts/demo-data.ts`: the command line. `load` and `remove`, with `--email-domain <domain>` (default `example.com`), `--staging-ref <project ref>` and, for `load`, `--new-links`. It decides the target before anything connects, finds the first Executive, then runs the loader and prints each account with its role and set-password link. No `package.json` entry.
- `apps/web/scripts/demo-data-target.ts`: the target guard, pure. It refuses `BOS_ENVIRONMENT=production`, and the production ref `ifnoytyhnedgiyhxxhhu` in any of the five database addresses, before every other test. It allows a local target only when every address is on this machine. Staging needs `BOS_ENVIRONMENT=staging` and `--staging-ref <ref>`, and every address must be on that one Supabase project (`db.<ref>.supabase.co` or the pooler user `<role>.<ref>`). It refuses anything else, including a mix of local and remote addresses.
- `apps/web/scripts/demo-data-loader.ts`: the set (`demoSet()`), `loadDemoData()`, `removeDemoData()` and `setPasswordLinks()`. Every write goes through `executeCommand()` as the operator, and every read through `executeQuery()` with existing domain queries. The loader writes no table directly. The set:
  - 9 items: three pumps, three controllers, a 540 Wp module, a structure and cable. Codes are `DEMO-…`; names end "(demo)".
  - 3 kits (3, 5 and 7.5 HP solar pump kits), each with a literal price on the shared Retail, Dealer and Commercial lists.
  - 5 customers, all "(demo)": Bhanwar Lal Jat has leads in Shakti Supreme and Agro Solar Hub (moved to Qualified), a borewell site with tehsil and district, a note, a call consent and the Retail tier. Ramesh Kumar Saini, Chomu, has a phone ending 4471 and is Contacted. Kamla Devi Meena has a rooftop lead. Agarwal Cold Storage is Commercial. Marwar Pump Traders is a dealer on the Dealer tier.
  - 11 people, one per role, invited through `admin.user.invite`. Their links come from the auth module's `requestPasswordReset`, the same flow as Admin › Team members. The script catches each message and prints the link instead of mailing it, and never makes or prints a password.
  - Load matches its own records by exact code, name and address. A second run makes no command call.
  - Remove closes every open demo lead as lost (`not_interested`), cancels open tasks, withdraws consents, archives kits then items, suspends every demo account (which revokes its sessions) and drops its cached access.
- `apps/web/src/auth/operator-principal.ts`: `firstExecutive()`. It finds the earliest active person whose every role is Executive and who can act, resolved from their grants as their sign-in would be. If none can act yet (no authenticator app), the script stops with a plain message.
- `docs/13-client-packs/wireframe-review.md` §1a: the one Demo data line names both commands.

**Tests**
- `apps/web/scripts/demo-data-target.test.ts`: 6 unit tests. They cover the production ref in any address, the production ref passed as `--staging-ref`, `BOS_ENVIRONMENT=production` even locally, local allowed, staging only when named and every address is on it, other hosts, a mix of local and remote, an unreadable address and missing addresses.
- `apps/web/tests/demo-data.test.ts`: 6 tests on real Postgres in the web suite, each run under its own tag, phones and email domain. They cover:
  - `firstExecutive()` resolving;
  - `load` making the set, then `load` again with 0 commands;
  - `--new-links` giving 11 fresh links with 0 commands;
  - the contents: 9 items, 3 kits, 12 Retail prices, Bhanwar's two companies, site, note, consent and tier, and 11 people invited, one per role;
  - `remove`, after which Catalogue items, Kits and the Retail item and kit price lists show no demo rows, every demo lead is lost with no open task or consent, and every account is suspended with its cache dropped;
  - the customers staying (below);
  - a second `remove` with 0 commands, and `load` after `remove` refused.
- I ran the command line itself on the local database: `load` made 75 changes and printed 11 links; `load` again made 0; `load --new-links` made 0 and printed 11 new links; `remove` made 30; `remove` again made 0; `load` after that was refused.

**Checks**
- `pnpm --filter web typecheck`: passed with no errors.
- `pnpm exec eslint apps/web/scripts apps/web/tests/demo-data.test.ts apps/web/src/auth/operator-principal.ts --max-warnings 0`: no output (clean).
- `pnpm --filter web exec vitest run`: Test Files 126 passed (126), Tests 961 passed, 1 skipped (962).
- `pnpm --filter web test:security`: Test Files 1 failed, 25 passed (26); Tests 1 failed, 338 passed (339). The failure is `tests/jobs-check.test.ts`, "reads every job as the worker principal…", which expects an `outbox-events-purge` late alert. It fails alone too.
  - On this slot's new database `cron.job_run_details` holds no run of any job, although the test relies on the migrations recording one purge run. It reports `audit-logs-partitions` instead.
  - This slice touches no job, worker or migration, so this comes from the slot's database. The lead can confirm on a database whose pg_cron has run.
- `tests/demo-data.test.ts` alone: 6 passed, three runs.
- `pnpm lint` (whole repository, through the lock): passed with no warnings.
- `check-doc-links.py`: bad 0.
- `EXPLAIN (ANALYZE)`: not applicable. The slice adds no list or search; it calls existing domain queries.

**What remove cannot take off (no command exists), and what stays in the append-only tables**
- **Customers stay visible.** No command archives a customer or a lead (only import rollback and merges archive them). The five customers stay in Customers, in search and on their page, still marked "(demo)", with their sites and contacts. Their leads stay as Lost on the board, the leads list and the customer's page.
  - This is the one point where the brief's "no demo record shows in any list a reviewer opens" is not met. The test states it rather than hiding it.
  - Meeting it needs a new command (for example `crm.account.archive`, or a lead archive), which this brief rules out. That is the lead's or owner's call.
- **Archived items and kits** are hidden from every list. The catalogue's archived filter still shows them, marked "(demo)".
- **Suspended accounts** stay in Team members as suspended, marked "(demo)". Their `principals` rows stay.
- **Price lists the loader makes stay.** If no shared live Retail, Dealer or Commercial list exists, the loader creates one from today and approves it. A live list cannot be archived, so it stays. Its `price_list_items` rows for the archived demo items and kits remain but show nowhere.
- **Append-only tables:** `price_change_log` (every demo price set), `activities` (lead created, stage moved, the note, lost, consent entries), `audit_logs` (every command and every operator read refusal, if any), `outbox_events`, and the withdrawn `consents` rows. `customer_duplicates` gets rows only if the duplicate check pairs a demo customer with another.

**Left out (no command, or client data)**
- **GST rates:** none are set. Tax rates are workshop inputs (CLAUDE.md), so a quote on the demo items, as task L2 asks, needs the rates for HSN 84137010, 85044090, 8541, 7308 and 8544. An Executive or Accounts enters them under Tax rates, or the owner decides otherwise.
- **Pump curves:** none are set, so sizing on the demo pumps has no curve.
- **Lead owners:** the demo leads are owned by the operator Executive. They are not assigned to the demo callers, who are still invited when the loader runs. So the callers' own Calling queue and board start empty of demo leads until a team lead assigns them (task T2 does that).

**Decisions the brief did not settle**
- **Operator lookup in the auth module:** I added `apps/web/src/auth/operator-principal.ts`, a file outside the brief's list. A script may not import `@shakti/db/grants`, and the auth module is the only place that resolves a principal before a request context exists.
- **Staging is identified by the operator:** the staging project ref is not recorded in the repository, so the person running the script names it with `--staging-ref`, together with `BOS_ENVIRONMENT=staging`.
- **Local target:** it requires every address to be local. `BOS_ENVIRONMENT=local` alone is not enough.
- **Companies per role:** Executive, General Manager and Inventory Manager in all four companies (a catalogue change needs "All companies"); Project Manager in Shakti Supreme and Agro Solar Hub; every other role in Shakti Supreme.
- **Addresses:** `demo.<role>@<domain>`, with `example.com` by default. Links are printed, never mailed.
- **No reload after remove:** `load` after `remove` is refused, because archived items cannot come back through any command.
- **`--new-links`:** I added it for links lost before a session. It writes no command.
- **Test-only options:** `demoSet({ tag, phone })` lets the suite reload on the shared database. The command line uses neither.

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
- Loading on staging is outside the standing go-ahead: the lead runs it only after the owner's yes.
