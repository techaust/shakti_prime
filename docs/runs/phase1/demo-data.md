# Demo data for the screen review (follow-up)

| | |
|---|---|
| Branch | `feat/demo-data` on GitHub |
| PC worktree | `demo-data`, slot: Postgres 54342, app 3042 |
| Runs on | PC |
| Tier | B ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)) |
| Usage | build Opus medium 1→2, 5h 7→14; review Opus high 2→2, 5h 14→20; fix round Opus medium 2→3, 5h 20→0 (window reset); measured: builder 1.18 and reviewer 0.27 points of the week |
| State | merged (#199) |
| Next step | none; loading on staging waits for the owner's yes, and review #1 and #2 for the owner's decision (STATUS) |

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

### 20-10-2026, PC, fix round
These fixes follow the review below.
- **#3:** `load --assign` gives the demo leads to the demo callers through `crm.opportunity.assign`, only when the owner differs. Bhanwar's Shakti Supreme lead goes to the lead converter; Ramesh's and Agarwal Cold Storage's leads go to the cold caller. A demo person who has not set a password yet is skipped, and the script prints their address (`waiting: …`).
  - Not done: putting the callers in a team with the demo Team Lead. No command makes a team (only the seed and the testing helpers write `teams`), so tasks T1 to T3 still need a team made in the app, or a team command in its own slice.
- **#4:** `operator-principal.ts` now refuses at its start when `NEXT_RUNTIME` is set or `hostedRuntime()` from `deps.ts` is true (`assertCommandLine`). I also moved its choice into `chooseExecutive()`, which the unit tests cover: none, not_ready, mixed roles passed over, and ready.
- **#5:** an address whose host holds a `,` is refused.
- **#6:** demo accounts are matched by address and the set's demo display name together. An address held by a person who is not a demo account is left alone and printed as a warning.
  - `remove` now looks up the accounts first. When it finds no demo account at the given domain, it changes nothing, names any demo accounts under another domain, and the command line exits 1.
- **#7:** the guard refuses a local target unless `BETTER_AUTH_URL` is on this machine, and staging unless it is https and not local.
- **#8:** `scripts/demo-data.test.ts` spawns the command line with production addresses on `.invalid` hosts. It exits 1 with the refusal, before "acting as" and with no lookup error.
- **#9:** every command now passes `client: { ip: null, device: 'scripts/demo-data.ts' }`, the option `executeCommand` already has, so the Activity log tells the script's rows from the Executive's own. This is tested, and the runner is unchanged. The line in `docs/07-security.md` §3.1 is not written; that document is outside this slice's files, so it stays open for the lead.
- **#10:** a shared draft of the tier dated today, left by a stopped run, is approved and reused instead of a second list being made. Every list the loader makes is printed, with "it stays after remove". This path has no test: the shared database always has live lists by then.
- **#11:** the §1a line names `BOS_ENVIRONMENT=staging`, `--staging-ref`, `--email-domain` and `--assign`. It says that the demo customers stay listed, marked "(demo)", with their leads Lost, and that the records reviewers make in the sessions are not removed.
- **#1 and #2:** left open for the owner.

**Tests and checks** (each through the lock):
- Web unit tests, `scripts` and `src/auth`: Test Files 12 passed, Tests 113 passed. This includes the guard (8), the operator (4) and the command line (1).
- `tests/demo-data.test.ts` (security config): Tests 9 passed (9). The new tests cover the audit device, `--assign` before and after the callers set their passwords (0, 3 and 0 commands), and a non-demo person at a demo address being left invited, with 11 demo accounts named under another domain.
- `pnpm --filter web typecheck`: passed.
- Lint of `apps/web/scripts`, `apps/web/src/auth` and the test file: clean. One prefer-optional-chain error went into 9e3238f7 and was fixed in c7d813db.
- The command line with a wrong `--email-domain`: 0 changes, the 11 demo accounts named under `example.com`, exit 1.

## Review
| # | Severity | Finding | State |
|---|---|---|---|
| 1 | Medium | `remove` leaves the five customers and their leads (now Lost) in Customers, search, the leads list, the board's Lost column and each customer's page (`demo-data-loader.ts:794-834`; `tests/demo-data.test.ts` "keeps the customers"), so Brief item 7 and its done criterion ("each list a reviewer opens is empty of demo records") are not met. No command archives a customer or a lead, and the brief rules out a new one. Confirmed. Fix: the owner decides between a customer or lead archive command in its own slice and accepting the "(demo)" rows on staging; until then the §1a line should not say the set is removed. | open |
| 2 | Medium | `remove` reaches only the set's own five customers, nine items, three kits and eleven accounts (`demo-data-loader.ts:794-859`). What the reviewers make in the sessions stays: the quote of task L2 on a demo kit, the walk-in customer of S1 and the new lead of C4 (names the reviewer types, with no "(demo)"), their calls, sizings and tasks, and anyone the demo Executive or HR Admin invites in Admin › Team members. Confirmed by reading. Fix: `remove` also withdraws open quotes holding a `DEMO-` line and closes leads and accounts created by a demo account (found through `listUsers` and each list's creator), or the report and §1a say plainly that the session's own records stay. | open |
| 3 | Medium | The set does not let the caller roles do their tasks. Every demo lead is owned by the operator Executive (`createLead` sets `ownerId` to the actor) and the demo people get no team, while the tele-callers and the Store Manager read leads and customers at `own` scope and the Sales Team Lead at `team` scope (`packages/db/seeds/role-permissions.ts:24-56`). So C1 (a calling queue), C5 (the lead ending 4471), T1-T3 (a team and a converter's leads) and L1 and L3 (Bhanwar's lead and note, for the converter) find nothing. `crm.lead.assign` refuses an invited assignee (`assign-opportunity.ts:24-70`), so it cannot run in the first `load`. Confirmed by reading. Fix: a later `load`, run once the demo people have set their passwords, puts the callers in a team and assigns the demo leads to them through `crm.lead.assign` (idempotent: only when the owner differs), and the report says to run it. | fixed (9e3238f7): `load --assign`; no command makes a team, so the team step is left out |
| 4 | Medium | `apps/web/src/auth/operator-principal.ts:27-51` is a function that returns a full Executive principal with no sign-in, exported from the module every server action imports from. No lint rule or runtime check keeps it out of a request path, and the scripts' own fence on `@shakti/db/grants` (`eslint.config.mjs:567-580`) is sidestepped by putting it under `src/auth`. Nothing calls it from a request today, so no path is widened now, and the principal it builds is exactly the Executive's own (`resolvePrincipalFromGrants` with no active company, the authenticator check kept). Confirmed by reading. Fix: refuse at its start when it runs inside Next (`process.env.NEXT_RUNTIME` set) or on a hosted runtime, with a unit test; a lint restriction would change the checks and need `checks-ok`. | fixed (9e3238f7) |
| 5 | Low | The target guard accepts a host list. `new URL()` keeps `a.example.com,aws-0-ap-south-1.pooler.supabase.com` as one hostname that ends in `.pooler.supabase.com`, so `supabaseProjectRef` (`demo-data-target.ts:36-39`) takes the staging ref from the user name, while postgres.js (3.4.9, `parseUrl` multihost) connects to `a.example.com` first. Production itself stays refused: every production address carries its ref, and a bare address with the pooler's user would fail sign-in and TLS name checks. Confirmed (URL parsing run in Node; postgres.js read). Fix: refuse any hostname with `,` (one host per address), with a test. | fixed (9e3238f7, c7d813db) |
| 6 | Low | Accounts are matched by address alone (`demo-data-loader.ts:760`, `:851`). A `remove` run with another `--email-domain` than the `load` leaves every demo account active with no warning, and a person who is not demo but has the address `demo.<role>@<domain>` is taken as one: suspended by `remove`, sent a new link by `load --new-links`. Confirmed by reading. Fix: also require the display name to end with "(demo)", and have `remove` report demo-named accounts it found under another domain. | fixed (9e3238f7) |
| 7 | Low | The links' host comes from `BETTER_AUTH_URL` in `.env`, which the guard does not check (`demo-data.ts:78`, `setPasswordLinks`). With the staging database and a local `.env` it prints `http://localhost:3000/...` links that a reviewer cannot open. Plausible. Fix: on a staging target, refuse unless `BETTER_AUTH_URL` is https and not local. | fixed (9e3238f7) |
| 8 | Low | Tests: the `firstExecutive()` case only asserts `ready` on the shared database (`tests/demo-data.test.ts:122-128`); nothing covers `none`, `not_ready` or a person who is Executive in one company and holds another role elsewhere being skipped, and the loader's cases act as `principalFor(...)` rather than the principal `firstExecutive()` returns. The command line's order (target decided before the first query) has no test. Confirmed. Fix: cases for the three outcomes with their own users; a test that `demo-data.ts` refuses a production address before any connection (spawned with a production `DATABASE_URL` and no network). | fixed (9e3238f7) |
| 9 | Low | SECURITY does not record that a command-line script acts as the first Executive without a sign-in, and the audit rows of the 75 changes name the owner's account with no request details marking them as the script's (`executeCommand` is called with no `commandOptions`, `demo-data-loader.ts:456`). Confirmed. Fix: one line in `docs/07-security.md` §3.1 naming the script, who may run it and where; optionally pass a request id prefix or user agent such as `demo-data` in the command options. | fixed (9e3238f7): audit device only; SECURITY line open |
| 10 | Low | `tierLists` (`demo-data-loader.ts:522-539`) creates and approves a shared live list when a tier has none. A run stopped between `createPriceList` and `approvePriceList` leaves a draft and the next run makes a second one; the made list stays after `remove`. Confirmed by reading. Fix: reuse a shared draft of the tier made today before creating one; list made lists in the report (it already names the live one). | fixed (9e3238f7) |
| 11 | Low | The §1a line of `wireframe-review.md` gives the two commands without `BOS_ENVIRONMENT=staging` and `--staging-ref <ref>`, so on staging the command as written is refused, and it says the set is removed although the customers stay (finding 1). Confirmed. Fix: name the two flags there or in DEPLOY, and say what stays. | fixed (ace514af) |

Checked and sound: production is refused first by `BOS_ENVIRONMENT=production` and by its ref anywhere in any of the five addresses (raw string, case-folded), before the first query; a local target needs every address on this machine; a remote one needs `BOS_ENVIRONMENT=staging`, `--staging-ref` and every address on that one project; a mix is refused; an unreadable address fails closed; `.env` is loaded by the database package's import before the guard runs, and `dotenv` does not override variables already set. Every write of the loader goes through `executeCommand()` and every read through `executeQuery()` with a name; no table is written directly and no raw client or `@shakti/db/grants` is imported by the scripts. The set-password links come from the auth module's own `requestPasswordReset` into an in-memory mailer and go only to the terminal; no password is made or printed; nothing is mailed or logged. Remove matches items and kits by exact code, customers by exact "(demo)" name; second `load` and second `remove` run no command. No `package.json` script, migration, schema, command or `en.json` change. GST rates and pump curves for the demo HSNs are not set (a workshop input), so task L2's GST total needs them on staging first; that is the owner's call, not a defect. Run by the reviewer on the slot database (54342), through the lock: `scripts/demo-data-target.test.ts` 6 passed, `tests/demo-data.test.ts` (security config) 6 passed.

## Integration notes
- Loading on staging is outside the standing go-ahead: the lead runs it only after the owner's yes.
