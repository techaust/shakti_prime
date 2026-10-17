# Cutover

How the Shakti group moves from its old records to the BOS (PRD IMP-02): two rehearsals, the count check of every file, the cutover weekend hour by hour, the go/no-go rule, the way back, and who does what. Production is `https://shaktiprime.com` (the Supabase project `shakti-prime-production` on Pro, without point-in-time recovery, Vercel Pro, deployed only by a release the owner approves, [DEPLOY §2](deploy.md#2-every-deploy) step 10); this runbook starts once production has had its first release, its first Executive and its schedules, and the [parallel run](../13-client-packs/parallel-run.md) follows it.

**Where the real files go.** A real customer file never goes to staging or dev: staging holds synthetic or anonymised data only (BLUEPRINT §7.10), and the design places the reconciliation on real data in production (phase 1 design §10, G1). So the rehearsal is done twice: on staging with **anonymised copies** of the files (the format, the matching, passing the leads on and the timings), and on **production before go-live** with the real files, after which production is put back in place from a copy taken at the moment before the rehearsal, under a freeze, and checked by counts (§2.2).

**Where the real files are kept.** The data owner holds the real files on the group's own storage: a folder the group controls, shared with the cutover lead for the cutover only. They never go into the code repository, onto staging or dev, into email or into chat. The cutover lead opens them only from there, to make the anonymised copies (§2.1) and to import them on production (§2.2, §3), and keeps no copy on their own machine afterwards. The rehearsal's uploads in production's files bucket are deleted on the day of the restore (§2.2 step 7); the weekend's uploads stay as the record of each import.

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
| Two days before | Cutover lead | Confirm production's 6-hourly copies arrive and the last restore drill passed (DATABASE §10), production's QStash schedules, and that Integration health shows no waiting or failed messages. Freeze the old system's structure: no new columns or codes until the parallel run ends. |
| The day before | Data owner | Announce the freeze: from Friday 18:00 nothing new is entered in the old system; what arrives is written on paper or in the day's sheet and entered in the BOS on Monday. |

## 2. The rehearsals

### 2.1 Staging, with anonymised copies
1. The cutover lead makes an anonymised copy of each file, working from the group's folder: every name, mobile number, email, address and village replaced by a made-up value of the same shape (a 10-digit number that starts with 6 to 9; a name of two words), each row kept, the columns and the row count unchanged, and repeated numbers kept repeated, so the file's repeats and refusals behave as the real file's do. Only the anonymised copies leave the group's folder.
2. Each anonymised file is imported on staging in the order of §3, by a person of the importer's role, and each caller's leads are passed on with **Move all leads**.
3. For each file, "What happened to each row" is downloaded as CSV and kept with the file. **Rows in the file** must equal the file's rows (the count check, §4).
4. The data owner and Accounts read the rows **Not added** with their reasons and decide, for each reason, to correct the file or leave the rows out.
5. Each step's time is written down; the weekend's plan (§3) is adjusted to the times measured.
6. The rehearsal's rows stay on staging: they are anonymised, which staging allows (BLUEPRINT §7.10). The cutover log records how many customers and leads each company gained (Customers and Leads, before and after).

### 2.2 Production, before go-live, with the real files
This rehearsal checks the real files against the real set-up: their counts, refusals and timings. Passing leads on with **Move all leads** is rehearsed on staging only (§2.1), so no caller is sent a notice about leads that are then taken away.

1. **Freeze.** The cutover lead announces the freeze to the group's GMs and the development team: from the restore point to the end of the restore (step 6), nobody but the cutover lead and the importer signs in to production, and nothing is set up or changed there; a change made in that time is lost by the restore without notice. The owner of the group's Upstash account pauses production's QStash schedules (the nightly jobs), so none runs on the rehearsal's data.
2. **Restore point.** The owner starts a copy by hand (AWS console › CodeBuild › `shakti-prime-production-backup` › **Start build**) once the freeze has started, waits for it to show *Succeeded* and writes down the last line of its log, `Kept <key>, version <version> (SHA-256 <sha>)`: the key, the version and the SHA-256 are the restore point, the time in IST and UTC, and the counts of customers and leads per company, shown on Customers and Leads, and of import jobs, shown on Imports, in the cutover log.
3. The importer imports the real files in the order of §3, with the count check (§4) for each, and each file's CSV is kept in the group's folder. The cutover lead writes down each import's file id (from its address on the Imports screen).
4. The lead anonymisation's dry run is run (the worker route `/api/v1/workers/crm/anonymise` with `{ "dryRun": true }`, signed by QStash, [API §3.6](../06-api.md)) and its count recorded: an imported lead's last change is its import date, so the count must be 0. A count above 0 means imported dates need checking before the weekend.
5. The data owner gives the go-ahead for the restore in the cutover log.
6. **Put back in place.** The owner downloads the version of step 2 and checks its SHA-256 (DATABASE §10, drill step 1) and, from the owner's PC with the PostgreSQL 17 client and production's migrator address (DEPLOY §4 step 1) with `?sslmode=verify-full&sslrootcert=<the certificate file>` after it, puts it back over production as DATABASE §10 *Putting a copy back over production* says (`pg_restore … --clean --if-exists --single-transaction --use-list=list.txt`, the entries the first drill wrote down left out), which replaces every table of the BOS's schemas with its content at the restore point in one transaction (nothing changes if it fails). The developer on call watches it. It is rehearsed first on a scratch project made from the same copy (DATABASE §10's drill, then the same command over it), and the owner may choose instead to switch on Supabase's point-in-time recovery for the rehearsal week and restore the project to the restore point in the dashboard. Supabase Pro's daily backup is no way back here: it is taken once a day, not at the restore point. Production is offline while it restores, and the restore cannot be undone. It removes everything the rehearsal made in the database: customers, leads, import jobs and rows, the timeline, notices and the audit rows.
7. **The files bucket.** The database restore does not reach the file store: the developer on call deletes each of the rehearsal's uploads from production's files bucket (kept under the company's number, `import` and the file's id, the ids of step 3), and the cutover log lists them.
8. **Checked by counts.** The counts of step 2 are read again and must be equal, company by company, and Imports shows none of the rehearsal's jobs. Any difference stops the plan until it is explained.
9. **Freeze ends.** The owner of the Upstash account starts the QStash schedules again, Integration health shows no waiting or failed messages, and the cutover lead tells the GMs and the development team that production is open again.

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

- **Before Monday 09:00:** production is put back in place from the copy taken at Friday 19:00's restore point (a copy started by hand then, as in §2.2 step 2), as in §2.2 steps 6 to 9 (the freeze holds until the restore ends), counts checked; the weekend's uploaded files are deleted from the files bucket. **Undo this import** is not the way back: by its own words it keeps the customers a leads file made and any customer with a lead, a consent or another company. The old system is unfrozen.
- **During the parallel run:** the BOS is not rolled back. A difference is logged and corrected in the BOS ([parallel run](../13-client-packs/parallel-run.md) §3); the old system stays read-only as the reference.

## 7. After the weekend

- The cutover lead files the cutover log (files, counts, CSVs, decisions, times, the deleted rehearsal files) with the [client actions](../13-client-packs/client-actions.md) record.
- The developer on call watches error reports and Integration health for the first week, and the nightly jobs (rescoring, duplicate search, quote expiry, lead anonymisation) in their logs.
