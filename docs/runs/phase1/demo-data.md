# Demo data for the screen review (follow-up)

| | |
|---|---|
| Branch | `feat/demo-data` on GitHub |
| PC worktree | `demo-data`, slot: Postgres 54342, app 3042 |
| Runs on | PC |
| Tier | B ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)) |
| Usage | build Opus medium 1→, 5h 7→ |
| State | building |
| Next step | the builder builds the loader and reports |

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

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
- Loading on staging is outside the standing go-ahead: the lead runs it only after the owner's yes.
