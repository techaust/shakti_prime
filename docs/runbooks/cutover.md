# Cutover

How the Shakti group moves from its old records to the BOS (PRD IMP-02): two rehearsals, the count check of every file, the cutover weekend hour by hour, the go/no-go rule, the way back, and who does what. Production itself (the paid Supabase project with point-in-time recovery, Vercel Pro, the group's domain) is slice G1; this runbook starts once production exists and the [parallel run](../13-client-packs/parallel-run.md) follows it.

**Where the real files go.** A real customer file never goes to staging or dev: staging holds synthetic or anonymised data only (BLUEPRINT §7.10), and the design places the reconciliation on real data in production (phase 1 design §10, G1). So the rehearsal is done twice: on staging with **anonymised copies** of the files (the format, the matching and the timings), and on **production before go-live** with the real files, after which production is put back to the moment before the rehearsal by point-in-time recovery (DATABASE §10), checked by counts.

**Roles** (never a person's name; the group names the people in [client actions](../13-client-packs/client-actions.md)):
- **Cutover lead:** the lead developer of the development team. Runs the plan, keeps the log, calls each checkpoint.
- **Data owner:** an Executive of the group. Supplies the final files, decides go or no-go, signs the counts.
- **Accounts:** the group's Accounts person. Checks the customer and dealer files against the old records.
- **Sales head:** checks the leads and pipelines, says which caller takes which leads, and briefs the callers.
- **Company GMs:** one General Manager per company. Check their company's counts and are the first contact for their staff on Monday.
- **Importer:** a team member made for the cutover in each company, with the General Manager role and no leads of their own, who imports the files; their leads are then passed on (§3). Suspended after the weekend.
- **Developer on call:** the second developer, who watches errors, the import worker and the database while the cutover lead runs the plan.

**What the BOS does today, and this runbook uses:** Imports (each file through *Choose the file*, *Match the columns*, *Check the rows* and *Add the rows*), the import's "What happened to each row" section with **Download as CSV**, Team members › **Move all leads**, Customers, Leads, Dealer credit, Roles, Pipelines, Price lists, Catalogue, Tax rates and Integration health. A leads file brings the customer, the mobile number, the village and PIN, the pipeline and the source; it does **not** bring an owner or a stage. Every imported lead belongs to the person who imports it and starts at the pipeline's first stage. So each caller's leads come in a file of their own and are passed to the caller with **Move all leads**, and the old system's stages are not carried over: callers move their leads on as they call them. An owner and a stage column on the leads import are a prerequisite for a later slice if the group wants them carried.

## 1. Before the cutover

| When | Who | What |
|---|---|---|
| Four weeks before | Data owner, Accounts, sales head | Agree the list of files: customers (one file per company, or one with a company column); leads, **one file per caller per company**; dealers' credit limits and outstanding; items and price lists. Fix the old records' own errors in the old system, not in the BOS. |
| Three weeks before | Cutover lead | Set up production's companies, team members (the callers and an importer per company), roles, pipelines, call outcomes, tax rates, items and price lists from the workshop's answers; nothing from staging is copied. |
| Two weeks before | Cutover lead | **Staging rehearsal** (§2.1) with anonymised copies of every file. |
| Ten days before | Cutover lead, data owner | **Production rehearsal** (§2.2) with the real files, then production put back. |
| One week before | Cutover lead, Accounts, sales head | Correct the files from the rehearsals' refusals; repeat the staging rehearsal on anonymised copies of the corrected files; record the time each file took. |
| Two days before | Cutover lead | Confirm production's backups and point-in-time recovery (DATABASE §10), production's QStash schedules, and that Integration health shows no waiting or failed messages. Freeze the old system's structure: no new columns or codes until the parallel run ends. |
| The day before | Data owner | Announce the freeze: from Friday 18:00 nothing new is entered in the old system; what arrives is written on paper or in the day's sheet and entered in the BOS on Monday. |

## 2. The rehearsals

### 2.1 Staging, with anonymised copies
1. The cutover lead makes an anonymised copy of each file on the developer's own machine: every name, mobile number, email, address and village replaced by a made-up value of the same shape (a 10-digit number that starts with 6 to 9; a name of two words), each row kept, the columns and the row count unchanged, and repeated numbers kept repeated, so the file's repeats and refusals behave as the real file's do. The real files are never copied to staging.
2. Each anonymised file is imported on staging in the order of §3, by a person of the importer's role, and each caller's leads are passed on with **Move all leads**.
3. For each file, "What happened to each row" is downloaded as CSV and kept with the file. **Rows in the file** must equal the file's rows (the count check, §4).
4. The data owner and Accounts read the rows **Not added** with their reasons and decide, for each reason, to correct the file or leave the rows out.
5. Each step's time is written down; the weekend's plan (§3) is adjusted to the times measured.
6. The rehearsal's rows stay on staging: they are anonymised, which staging allows (BLUEPRINT §7.10). The cutover log records how many customers and leads each company gained (Customers and Leads, before and after).

### 2.2 Production, before go-live, with the real files
1. Before anything is imported, the cutover lead notes the time (the restore point) and the counts of customers and leads per company, shown on Customers and Leads, and of import jobs, shown on Imports.
2. The real files are imported in the order of §3, with the count check (§4) for each, and each file's CSV kept.
3. The lead anonymisation's dry run is run (the worker route `/api/v1/workers/crm/anonymise` with `{ "dryRun": true }`, signed by QStash, [API §3.6](../06-api.md)) and its count recorded: an imported lead's last activity is its import date, so the count must be 0. A count above 0 means imported dates need checking before the weekend.
4. **Put back**: production is restored by point-in-time recovery to the restore point (DATABASE §10, the restore drill's steps 1 to 3 on production itself), which removes everything the rehearsal made, customers, leads, import jobs, rows and timeline included. The file store keeps the rehearsal's uploaded files: the developer on call deletes each from the files bucket, where it is kept under the company's number, `import` and the file's id (the id the cutover log took from each import's address on the Imports screen), and the cutover log lists them.
5. **Checked by counts**: after the restore, the counts of step 1 are read again and must be equal, company by company; Imports shows none of the rehearsal's jobs. Any difference stops the plan until it is explained.

## 3. The cutover weekend

Times are IST. The old system is frozen from Friday 18:00 (§1).

| When | Who | What | Checkpoint |
|---|---|---|---|
| Fri 18:00 | Data owner | Old system frozen; final export of every file. | Every file received, with its row count from the old system. |
| Fri 19:00 | Cutover lead | Production backup taken and the restore point noted; Integration health clean. | Backup recorded. |
| Sat 09:00 | Importer of each company | Import the **customers** files, company by company. | Each file's counts add up (§4). |
| Sat 12:00 | Accounts | Check 20 customers per company against the old records: name, mobile, village, company. | No more than 1 difference per 20; every difference logged. |
| Sat 13:00 | Importer of each company | Import the **leads** files, one caller's file at a time; after each, Team members › the importer › **Move all leads** to that caller, repeated until no lead is left with the importer. | Each file's counts add up; the caller's lead count on Leads grew by the rows added. |
| Sat 16:00 | Sales head | Check 20 leads per company: owner, pipeline and customer (every imported lead starts at the first stage). | No more than 1 difference per 20. |
| Sat 17:00 | Accounts | Enter **dealer credit** (limits and outstanding) on Dealer credit, from the old system's ledger. | Total outstanding equals the old ledger's total per company. |
| Sat 18:00 | Cutover lead, data owner | **Go/no-go** (§5). | Decision recorded. |
| Sun 10:00 | Company GMs | Each GM signs in, opens Home, Leads and Customers for their company, and checks their team's people and roles on Team members. | Each GM confirms in writing. |
| Sun 12:00 | Sales head | Callers' first queues checked on Calling; targets set on Targets. | Every caller with a leads file has a queue. |
| Sun 16:00 | Cutover lead | The importers suspended on Team members; final backup; old system set to read-only for the parallel run. | Backup recorded. |
| Mon 09:00 | Everyone | Work starts in the BOS. The [parallel run](../13-client-packs/parallel-run.md) begins. | Developer on call watching. |

## 4. The count check

For every file:
- **Rows in the file** on the import's "What happened to each row" equals the number of rows the old system exported (header row not counted).
- The lines below it add up to it: added as new records, added to records already in the list, repeated in the file, not added, checked but not added yet, added then taken back. After a finished import, "Checked, not added yet" and "Added, then taken back" are 0.
- Every row **Not added** has a reason, and the data owner has accepted leaving it out or corrected it and imported it again in a new file.
- The CSV download is kept with the file and the old system's count in the cutover log; the data owner signs the log for each file.

## 5. Go/no-go

At Saturday 18:00 the data owner decides, on the cutover lead's report:
- **Go** when every file's counts add up, the rows not added are accepted, every caller's leads are with that caller, the checks of 20 customers and 20 leads per company found no more than 1 difference each, dealer outstanding totals match, and no error is open on Integration health.
- **No-go** on any other result. On no-go the cutover lead puts production back (§6) and the group goes on in the old system on Monday; a new weekend is set once the cause is fixed and the rehearsals repeated.

## 6. The way back

- **Before Monday 09:00:** production is restored by point-in-time recovery to Friday 19:00's restore point, as in §2.2 steps 4 and 5, counts checked; the weekend's uploaded files are deleted from the files bucket. **Undo this import** is not the way back: by its own words it keeps the customers a leads file made and any customer with a lead, a consent or another company. The old system is unfrozen.
- **During the parallel run:** the BOS is not rolled back. A difference is logged and corrected in the BOS ([parallel run](../13-client-packs/parallel-run.md) §3); the old system stays read-only as the reference.

## 7. After the weekend

- The cutover lead files the cutover log (files, counts, CSVs, decisions, times, the deleted rehearsal files) with the [client actions](../13-client-packs/client-actions.md) record.
- The developer on call watches error reports and Integration health for the first week, and the nightly jobs (rescoring, duplicate search, quote expiry, lead anonymisation) in their logs.
