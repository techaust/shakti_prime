# Cutover

How the Shakti group moves from its old records to the BOS (PRD IMP-02): a dry run on staging, the count check of every file, the cutover weekend hour by hour, the go/no-go rule, the way back, and who does what. Production itself (the paid Supabase project, Vercel Pro, the group's domain) is slice G1; this runbook starts once production exists and the [parallel run](../13-client-packs/parallel-run.md) follows it.

**Roles** (never a person's name; the group names the people in [client actions](../13-client-packs/client-actions.md)):
- **Cutover lead:** the lead developer of the development team. Runs the plan, keeps the log, calls each checkpoint.
- **Data owner:** an Executive of the group. Supplies the final files, decides go or no-go, signs the counts.
- **Accounts:** the group's Accounts person. Checks the customer and dealer files against the old records.
- **Sales head:** checks the leads, owners and pipelines, and briefs the callers.
- **Company GMs:** one General Manager per company. Check their company's counts and are the first contact for their staff on Monday.
- **Developer on call:** the second developer, who watches errors, the import worker and the database while the cutover lead runs the plan.

**Everything in this runbook uses screens and jobs that exist:** Imports (each file through Upload → Match the columns → Check the rows → Add), the import's "What happened to each row" section and its CSV download, Customers, Leads, Team members, Roles, Pipelines, Price lists, Catalogue, Tax rates, and Integration health.

## 1. Before the cutover

| When | Who | What |
|---|---|---|
| Four weeks before | Data owner, Accounts, sales head | Agree the list of files and their owners: customers (one file per company or one with a company column), leads with their owner and stage, dealers' credit limits and outstanding, items and price lists. Fix the old records' own errors in the old system, not in the BOS. |
| Three weeks before | Cutover lead | Set up production's companies, team members, roles, pipelines, call outcomes, tax rates, items and price lists from the workshop's answers; nothing from staging is copied. |
| Two weeks before | Cutover lead, data owner | **Staging dry run** (§2) with a full copy of the files. |
| One week before | Cutover lead, Accounts, sales head | Correct the files from the dry run's refusals; run the dry run again on the corrected files; record the time each file took. |
| Two days before | Cutover lead | Confirm the backups of production (DATABASE §10), the QStash schedules of production, and that Integration health shows no waiting or failed messages. Freeze the old system's structure: no new columns or codes until the parallel run ends. |
| The day before | Data owner | Announce the freeze: from Friday 18:00 nothing new is entered in the old system; what arrives is written on paper or in the day's sheet and entered in the BOS on Monday. |

## 2. The staging dry run

The dry run is the cutover rehearsed on staging with a copy of the real files, deleted from staging when it ends (staging otherwise holds synthetic data only).

1. The cutover lead imports each file on staging in the order of §3, as the person who will import it on the weekend.
2. For each file, the "What happened to each row" section of its import is downloaded as CSV and kept with the file. **Rows in the file** must equal the rows the old system exported (the count check, §4).
3. The data owner and Accounts read the rows **Not added** with their reasons and decide, for each reason, to correct the file or to leave the rows out.
4. The cutover lead runs the lead anonymisation in its dry run (the worker route `/api/v1/workers/crm/anonymise` with `{ "dryRun": true }`, signed by QStash, [API §3.6](../06-api.md)) and records how many imported leads it would anonymise: old unqualified leads with no transaction are anonymised 24 months after their last activity (BLUEPRINT §7.9), and an imported lead's last activity is its import date, so the count should be 0. A count above 0 means imported dates need checking before the weekend.
5. Each step's time is written down; the weekend's plan (§3) is adjusted to the times measured.
6. The cutover lead deletes the imported rows from staging (each import's **Undo this import**, then the files).

## 3. The cutover weekend

Times are IST. The old system is frozen from Friday 18:00 (§1).

| When | Who | What | Checkpoint |
|---|---|---|---|
| Fri 18:00 | Data owner | Old system frozen; final export of every file. | Every file received, with its row count from the old system. |
| Fri 19:00 | Cutover lead | Production backup taken; Integration health clean. | Backup recorded. |
| Sat 09:00 | Cutover lead | Import the **customers** files, company by company. | Each file's counts add up (§4). |
| Sat 12:00 | Accounts | Check 20 customers per company against the old records: name, mobile, village, company. | No more than 1 difference per 20; every difference logged. |
| Sat 13:00 | Cutover lead | Import the **leads** files, with owners and stages. | Each file's counts add up; leads attached to the customers imported in the morning. |
| Sat 16:00 | Sales head | Check 20 leads per company: owner, stage, pipeline, customer. | No more than 1 difference per 20. |
| Sat 17:00 | Accounts | Enter **dealer credit** (limits and outstanding) on Dealer credit, from the old system's ledger. | Total outstanding equals the old ledger's total per company. |
| Sat 18:00 | Cutover lead, data owner | **Go/no-go** (§5). | Decision recorded. |
| Sun 10:00 | Company GMs | Each GM signs in, opens Home, Leads and Customers for their company, and checks their team's people and roles on Team members. | Each GM confirms in writing. |
| Sun 12:00 | Sales head | Callers' first queues checked on Calling; targets set on Targets. | Every caller has a queue. |
| Sun 16:00 | Cutover lead | Final backup; old system set to read-only for the parallel run. | Backup recorded. |
| Mon 09:00 | Everyone | Work starts in the BOS. The [parallel run](../13-client-packs/parallel-run.md) begins. | Developer on call watching. |

## 4. The count check

For every file:
- **Rows in the file** on the import's "What happened to each row" equals the number of rows the old system exported (header row not counted).
- The lines below it add up to it: added as new records, added to records already in the list, repeated in the file, not added, checked but not added yet, added then taken back. After a finished import, "Checked, not added yet" and "Added, then taken back" are 0.
- Every row **Not added** has a reason, and the data owner has accepted leaving it out or corrected it and imported it again in a new file.
- The CSV download is kept with the file and the old system's count in the cutover log; the data owner signs the log for each file.

## 5. Go/no-go

At Saturday 18:00 the data owner decides, on the cutover lead's report:
- **Go** when every file's counts add up, the rows not added are accepted, the checks of 20 customers and 20 leads per company found no more than 1 difference each, dealer outstanding totals match, and no error is open on Integration health.
- **No-go** on any other result. On no-go the cutover lead rolls back (§6) and the group goes on in the old system on Monday; a new weekend is set once the cause is fixed and the dry run repeated.

## 6. The way back

- **Before Monday 09:00:** each import is undone from its page (**Undo this import**, newest first), dealer credit entries are left (they are a ledger and are corrected by a new entry), and production is restored from Friday's backup when anything else was changed. The old system is unfrozen.
- **During the parallel run:** the BOS is not rolled back. A difference is logged and corrected in the BOS ([parallel run](../13-client-packs/parallel-run.md) §3); the old system stays read-only as the reference.

## 7. After the weekend

- The cutover lead files the cutover log (files, counts, CSVs, decisions, times) with the [client actions](../13-client-packs/client-actions.md) record.
- The developer on call watches error reports and Integration health for the first week, and the nightly jobs (rescoring, duplicate search, quote expiry, lead anonymisation) in their logs.
