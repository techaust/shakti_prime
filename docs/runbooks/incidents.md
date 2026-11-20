# Incidents: what to do when something goes wrong

Plain steps for the owner or the developer on duty, one section per kind of trouble. Each step names the screen or the page to open. The hosted environments are listed in [STATUS](../10-status.md#hosted-environments); how they are set up is in [DEPLOY](deploy.md). Nothing here changes a hosted environment without the owner's go-ahead.

**Who to tell.** When a step does not clear the trouble, or before anything is changed by hand, the owner tells the developer (Techaust) by phone or message with:
- the site's address (dev or staging) and the time it started, in IST;
- the first red line: of the failed run, the deployment log, the Sentry alert or the page that failed, copied as it is, with its request id when it has one;
- what was being done at the time, and what has been tried.

Never send a password, key or secret value; a screenshot of a settings page is checked for them first.

**The Phase 2 channels** (sections 12 to 18): WhatsApp, Exotel, LiveKit, the speech service and the Phase 2 agents run on dev and staging with sandbox accounts until the final phase; production has none of their settings, so its screens say the channel is not set up ([phase 2 design §2](../03-roadmap-appendix/phase2.md#2-decisions-for-the-owner), question 13). The Sentry alerts these sections name (`webhooks.failing`, `webhooks.backlog`, `whatsapp.quality_low`, `whatsapp.budget_high`, `ai.spend_high`, `voice.spend_high`) email the owner like the alerts of §2 and §11, with counts and ids only.

## Contents
1. [The site is down](#1-the-site-is-down)
2. [Updates are stuck or failing](#2-updates-are-stuck-or-failing)
3. [A migration failed](#3-a-migration-failed)
4. [Roll back a bad deploy](#4-roll-back-a-bad-deploy)
5. [A secret leaked](#5-a-secret-leaked)
6. [Restore from a backup](#6-restore-from-a-backup)
7. [A paused Supabase project](#7-a-paused-supabase-project)
8. [The AI service is down or an agent has stopped](#8-the-ai-service-is-down-or-an-agent-has-stopped)
9. [CI jobs do not start](#9-ci-jobs-do-not-start)
10. [Trouble on the owner's PC](#10-trouble-on-the-owners-pc)
11. [A scheduled job failed or stopped](#11-a-scheduled-job-failed-or-stopped)
12. [Calling from the screen is down](#12-calling-from-the-screen-is-down)
13. [A WhatsApp template was turned down](#13-a-whatsapp-template-was-turned-down)
14. [The WhatsApp messaging limit is reached](#14-the-whatsapp-messaging-limit-is-reached)
15. [Exotel is down](#15-exotel-is-down)
16. [LiveKit is down: type instead of talking](#16-livekit-is-down-type-instead-of-talking)
17. [The speech service is down](#17-the-speech-service-is-down)
18. [The AI provider is down: people take the chats](#18-the-ai-provider-is-down-people-take-the-chats)

## 1. The site is down
1. Open `<site>/api/v1/health`. A 200 means the app is running; no answer means the deployment itself is down (go to step 3).
2. Open `<site>/api/v1/health/ready`. A 200 with `status: ok` means every dependency answers. A 503 means one is down: the database, the reader pool the screens read through (when `DATABASE_URL_READER` is set; most often its password no longer matches after a rotation), the auth database, the key-value store (Upstash Redis), the configuration, or the outbox (an update has waited more than five minutes past its time, so the publisher is not running). The page never names which. Sentry's uptime monitor on this address emails the owner when it fails ([DEPLOY §1](deploy.md#1-before-the-first-deploy-once-per-environment) step 8).
3. In Vercel, open the project (`shakti-prime-dev` or `shakti-prime-staging`) › **Deployments**: the latest deployment of `main` must be **Ready**. A failed build shows its log there; a deployment that refuses to start lists the missing or unsafe variables in its runtime log (`productionConfigProblems()`, [DEPLOY §1](deploy.md#1-before-the-first-deploy-once-per-environment)).
4. In Vercel › **Logs**, search for `health.not_ready` with the request id the readiness page returned (header `x-request-id`): the line names the check that is down.
5. Check the provider of that check: the Supabase project's dashboard and status page for the database, the Upstash console for Redis and QStash, Cloudflare for Turnstile. A provider outage is waited out; a changed or expired value is fixed in Vercel's variables, then the deployment is redeployed. A database check down on dev or staging is most often a paused project (§7).
6. When the deployment itself is at fault (it broke after a merge), roll it back (§4).

## 2. Updates are stuck or failing
Background updates (events) leave each change through the outbox and QStash. An Executive sees them on **Admin › Integration health** (`/admin/integrations`).
1. **Updates waiting to go out** lists what is waiting by kind. A count that keeps growing with an old *Waiting since* means the publisher is not running: check that the QStash schedule calls `<site>/api/v1/workers/outbox/publish` every minute (Upstash console › QStash › Schedules) and that `/api/v1/health/ready` answers 200.
2. **Delivery speed** › **Check delivery speed** sends one update through the system and times it. It should arrive within seconds; handing a lead over depends on it staying under 10 seconds.
3. **Held-back updates** lists updates held back after ten tries, or refused for good by the step that handles them, with *What went wrong*. Fix the cause first (a missing variable, a provider outage, a fault in a worker), then press **Send again** on each: the update goes back in the queue with its tries reset, and the replay is recorded in the Activity log. Only the Executive holds this permission (`integrations.dlq.replay`).
4. **Files waiting for their checks** lists uploads still unchecked after ten minutes; **Check files again** runs their checks from where each stopped ([files-setup §3](files-setup.md#3-put-the-values-in-vercel)).
5. Sentry's alert rule *Message queue failing (outbox)* emails the owner when the publisher holds an update back (`outbox.dead_lettered`) or when a third sending round in a row fails to deliver anything it tried (`outbox.publisher_failing`). The alert carries counts and ids only; the page above shows the detail.

## 3. A migration failed
Migrations reach a hosted database only through GitHub › **Actions** › *Migrate a hosted database*, run from `main` ([DEPLOY §2](deploy.md#2-every-deploy)).
1. Open the failed run and read the first failing step:
   - *Only from main* or *Secrets present and for this project*: the run was started from another branch, a secret is missing, or the address names another Supabase project. Fix the secret in GitHub › Settings › Secrets and variables › Actions, then run again.
   - `pnpm db:migrate` (`pnpm db:migrate --rotate-passwords` on a rotation run, [DEPLOY §5](deploy.md#5-rotating-a-secret)): the database's own error is in the log. The migrator applies every pending migration in one transaction under an advisory lock, so a failure leaves the database as it was. A table lock held by live traffic for more than 10 seconds also stops it; run again at a quiet moment.
   - `pnpm db:verify`: a migration on disk is not applied exactly as written (a changed file, or one the journal skipped because its time is older than the last one applied).
   - *Seed*: the migrations are in; rerun the workflow with the same choice, since the seed is safe to repeat.
2. **Never edit a migration that a hosted database has applied.** A fix is a new migration after the last one, merged through a pull request, then the workflow is run again.
3. A migration that builds an index concurrently cannot run in the migrator's transaction: build the index by hand first ([DEPLOY §3](deploy.md#3-a-migration-that-builds-an-index-concurrently)).
4. After a successful run, check `/api/v1/health/ready` on the environment's site.

## 4. Roll back a bad deploy
1. In Vercel, open the project › **Deployments**, find the last deployment that worked, open its menu (three dots) and choose **Instant Rollback** (or **Promote** on an older deployment). It serves the production address within a minute; check `/api/v1/health` and `/api/v1/health/ready`.
2. **Dev and staging:** Vercel deploys every merge to `main` to both projects, so the next merge replaces the rollback: fix the fault in a pull request before anything else merges, or add the `hold` label to the open pull requests meanwhile.
3. **Production** changes only by a release ([DEPLOY §2](deploy.md#2-every-deploy) step 10), so a rollback there stands until the next release, which carries the fix. While a rollback stands, Vercel gives the production domain to no new deployment: before the next release the owner presses **Undo Rollback** on the deployments page, or promotes the release's deployment once it is *Ready* (**Promote**), or the release's wait ends with *Production does not serve …* ([DEPLOY §2](deploy.md#2-every-deploy) step 10). A release that stopped with *Production serves …, which no release approved* means a build no release asked for is live: the owner rolls it back as in step 1 at once, then tells the developer. When a release's build failed or was skipped, production keeps serving the commit before it; the owner may build the released commit by hand once (the production project › Deployments › the deployment of the commit tagged `release-<number>` › **Redeploy**, *Use project's Ignore Build Step* unticked), never another commit.
4. Migrations only go forward. Rolling the app back does not undo a migration, and the database stays where the release left it: the older code must run on it, which expand/contract allows ([DATABASE §8](../05-database.md#8-migrations) item 4). A schema fix is a new migration (§3), released like any other.

## 5. A secret leaked
Replace it at once, following [DEPLOY §5](deploy.md#5-rotating-a-secret) for the kind of secret; for the AWS access key, [files-setup §5](files-setup.md#5-rotating-the-access-key). A secret committed to the repository stays in its history, which is never rewritten on GitHub: replace the secret, then add the scan's fingerprint of the old value to `.gitleaksignore` in a pull request. Never replace `BETTER_AUTH_SECRET` outright: follow SECURITY §10.

## 6. Restore from a backup
Production has two ways back ([DATABASE §10](../05-database.md#10-backups-and-recovery), with the recovery targets and the restore drill): the copies made every 6 hours and kept 30 days, and Supabase Pro's daily backups of the project, kept 7 days (Supabase dashboard › Database › Backups), which Supabase restores over the same project. Restore a copy into a new scratch project first, after checking its SHA-256 against its build's log line, check it as the drill describes, and only then decide with the owner how to bring the data back: over production as DATABASE §10 *Putting a copy back over production* says, or, when the production project itself is lost, as *A restored project becomes production* says.
- **The copies stopped** (Sentry's `job.problem` with the job `database-backup`: `late`, `missing` or `failed`): open AWS › CodeBuild › `shakti-prime-production-backup` › **Build history** and the newest failed build's log. A line about the secret or its address means the backup login's password or address changed: run `tools/secrets/set-backup-login.ps1` again ([DEPLOY §1](deploy.md#1-before-the-first-deploy-once-per-environment) step 9). No build at all for hours means the schedule stopped: EventBridge › Rules › `shakti-prime-production-backup` must be *Enabled*. `failed` with builds succeeding means production's app user cannot list the bucket (the backup stack's `AppListsCopiesPolicy`). Then **Start build**, and tell the developer if it fails twice.

## 7. A paused Supabase project
Dev and staging run on Supabase's free plan, which pauses a project that has seen no activity for a while ([accounts](accounts.md#in-use)).
- **What fails while it is paused:** `/api/v1/health` still answers 200, but `/api/v1/health/ready` answers 503 (the database, the auth database and the outbox checks); nobody can sign in, every screen behind sign-in fails, the QStash schedule's calls to the publisher fail, and Sentry may report the errors. Nothing is lost: the data stays in the paused project.
1. Open supabase.com › organisation *Shakti Prime* › the project (`shakti-prime-dev` or `shakti-prime-staging`). A paused project says so on its page.
2. Press **Restore project** and wait until the dashboard shows the project as healthy (usually a few minutes).
3. Open `<site>/api/v1/health/ready`: it answers 200 with `status: ok`. Sign in once to confirm.
4. Nothing else is needed: the migrations, the roles and their passwords, and the scheduled jobs come back as they were, and the outbox delivers what waited on the next minute's run. Updates still listed as waiting after ten minutes are handled as in §2.
5. When the dashboard offers no restore, tell the developer (see *Who to tell*); never create a new project in its place without the owner's go-ahead.

## 8. The AI service is down or an agent has stopped
Agents only file suggestions in the Agent Inbox; when they stop, nothing else stops, and people work their leads and queues as before. An Executive or a General Manager sees each agent on **Admin › Agents** (`/admin/agents`).
- **What it looks like:** no new suggestions arrive. On **Admin › Agents** an agent shows **Stopped** (a kill switch), or its spending today has reached its daily limit (the company's or the group's, both apply), or the page says the AI service is not connected. In Vercel › **Logs**, `ai.breaker_opened` means the AI service failed five times in a minute and calls are paused for a minute.
1. A stopped agent: let it run again on **Admin › Agents** if it was stopped by mistake; suggestions already in an inbox wait and can be approved once it runs.
2. A limit reached: the agent starts again at midnight India time; an Executive may raise the limit on **Admin › Agents** if the day needs more.
3. The AI service failing: check the vendor's status page (Anthropic for Claude, Voyage for embeddings) and wait it out; the runs are recorded as unavailable and nothing is retried by hand.
4. When the service is up and the agent runs but still files nothing, tell the developer (see *Who to tell*).
5. The WhatsApp chats, the Co-pilot, Ask the Business and Talk to Shakti during a longer outage: §18.

## 9. CI jobs do not start
A run fails within seconds with no log, and a pull request does not merge. Open the failed job's check run: an annotation saying the job was not started because of payments or the spending limit means the month's Actions minutes are used up.
1. The owner sets an Actions budget in GitHub › Settings › Billing and plans, or the repository is public (its minutes are free), or the work waits for the monthly reset.
2. Then rerun the failed run: on GitHub open the repository › **Actions** › the failed run › **Re-run failed jobs** (or `gh run rerun <id>`); a merge-on-green run that failed this way is rerun the same way. A pull request whose CI ran on an older `main` is taken care of by the merge workflow, which takes `main` into its branch and tests it again; one that conflicts with `main` takes it by hand and is pushed again.

## 10. Trouble on the owner's PC
Slices are built and checked on the PC ([CLAUDE.md](../../CLAUDE.md)), which has 8 GB of memory and runs Docker Desktop for each slice's database. The lead session does the commands; the owner does the clicks below and tells the lead session what happened.
- **Docker Desktop is down.** The signs: the lead session says it cannot reach a database, or Docker Desktop's window shows *Engine stopped*.
  1. Click the Windows Start button, type `Docker Desktop` and open it.
  2. Wait until the bottom left of its window shows **Engine running** (a minute or two).
  3. Tell the lead session; it starts the slices' databases again and continues from the last commit.
- **The PC is out of memory.** The signs: the PC slows to a crawl, Docker Desktop stops by itself, a test run ends with *time out* or a browser container is killed.
  1. Tell the lead session at once; it stops the second builder and anything else heavy, and reruns the failed step alone.
  2. If the PC does not answer, close the extra windows (Docker Desktop, browsers) first, and wait for it to recover before clicking anything else.
  3. Work committed every 20 minutes survives; a builder that was stopped starts again from its last commit.
- **A builder has stalled.** The lead session reports it when a builder has made no commit and no file change for 20 minutes while no heavy command holds the lock. It stops that builder and starts a fresh one from the last commit with a precise list of what is left. Nothing is needed from the owner.
- **A stale heavy-command lock.** Heavy commands (whole-repository lint, typecheck, build, the security suite, journeys) wait their turn on a lock, the folder `.shakti-heavy.lock` in the Windows user folder. A lock left by a stopped agent clears itself after 90 minutes, when the next command asks for it. To clear it sooner, when the lead session says nothing is running:
  1. Open **File Explorer**, click the address bar, type `%USERPROFILE%` and press Enter.
  2. Turn on *View* › *Show* › *Hidden items* if no folder named `.shakti-heavy.lock` shows.
  3. Right-click `.shakti-heavy.lock` › **Delete**. Its file `owner` says which command held it, if the lead session asks.
  4. Leave the folder `.shakti-heavy.lock.queue` beside it alone: it holds the waiting commands' places in the queue.

## 11. A scheduled job failed or stopped
Two kinds of work run on a timer: the app's worker routes, which QStash calls (the file sweep, the nightly rescoring and duplicate search, the quote expiry, the notification scan and the jobs check), and the database's own jobs, which pg_cron runs (the partitions, the purges and the audit archive). Sentry's second alert rule ([DEPLOY §1](deploy.md#1-before-the-first-deploy-once-per-environment) step 8) emails the owner about either.
1. **`job.failing`** names a worker route (`job`, the schedule's id without its environment) that failed three calls in a row. In Sentry, the issue named after the route's failure line (for example `sales.quote_expiry_failed`) holds the error with its request id; send it to the developer. Check in the Upstash console › QStash › Schedules that the schedule `<job>-<environment>` exists and calls the site's address.
2. **`job.problem`** names a database job (`job`) and what is wrong (`problem`): `failed` (its last run failed), `stuck` (its run has gone on past its time limit, and no new run starts until it ends), `late` (it has not run for its period and six hours), `paused` (it is switched off) or `missing` (the database no longer schedules it). **Admin › Integration health** shows each job's last run. Send the alert and the page to the developer, who reads the error in the app's log (`jobs.problem`, with the job and the database's message) and, after the owner's go-ahead, runs the job again in the project's SQL editor; a `missing` or `paused` job comes back with the migration that schedules it ([DEPLOY §2](deploy.md#2-every-deploy) step 5).
   - The job `database-backup` is production's database copy, not a pg_cron job: `late` (the newest copy is older than 7 hours), `missing` (no copy in two days) or `failed` (the copies cannot be listed); follow §6 *The copies stopped*.
3. **A failed `activities-partitions` month** needs care: once a month's rows have landed in the default partition, that month's partition cannot be made until the developer moves them out (DATABASE §7). Tell the developer the same day; nothing is lost meanwhile, the timeline only reads more slowly.
4. Each problem is told once per job and run, and again after a week while it lasts; a job that runs well again clears it by itself.

## 12. Calling from the screen is down
Calls placed from the screen go through Exotel ([phase 2 design §6.3](../03-roadmap-appendix/phase2.md#63-t3-click-to-dial-and-recordings)); when Exotel is down, people dial by hand as before and nothing is lost.
- **What it looks like:** pressing **Call** on the Cold Caller or Converting workspace says "The call could not be placed. Try again, or dial by hand and save the call." with a reference, or the call bar stays on **Placing the call** and no phone rings. In Vercel › **Logs**, `calls.dial.uncertain` names a call Exotel never answered by its id, and a refused call logs `action.failed` with `dialCall` and the reference the screen showed (that line also reaches Sentry); Exotel's status page shows the outage.
1. Callers keep working: **Show number** (`D`) on the same lead shows the number to dial on their own phone, and the outcome keys save the call as before. When the call bar still shows **Placing the call**, reload the page first, so the save is recorded as a call dialled by hand and not tied to the call that never rang.
2. A call Exotel refused is closed at once. A call Exotel never answered is closed as not gone through by the sweep that runs at 17 minutes past each hour, once an hour has passed since it was pressed (so one to two hours after), and a call left ringing or on the line after three hours the same way, so the lead's history stays right; nothing is done by hand.
3. When Exotel is back, **Call** works again at once; on a lead whose call bar still shows an open call, reload the page. If it still fails, tell the developer (see *Who to tell*) with the time and a request id. A longer outage, with incoming calls and recordings, is §15.

## 13. A WhatsApp template was turned down
Every message a company starts on WhatsApp outside a customer's 24-hour window, and each customer update (the quote, the confirmed order, the welcome, the stop confirmation, the quote code), goes as a template Meta has approved ([phase 2 design §6.1](../03-roadmap-appendix/phase2.md#61-w1-whatsapp-threads-and-messaging)). Templates are written and sent for review in Meta's WhatsApp Manager, not in the app; Meta's answer reaches each template the app holds under the same name and language (English templates only), and Settings › WhatsApp templates (`/settings/whatsapp-templates`) shows it.
- **What it looks like:** no Sentry alert names a template.
  - **Admin › Integration health** › **WhatsApp**: the company's **Templates turned down** count rises.
  - **Settings › WhatsApp templates**: the template's **Review** reads **Turned down**, **Paused** or **Switched off**; under **Customer updates**, an update chosen with that template shows its state beside its name, and such an update "is held, not sent".
  - **Admin › Activity log**: "WhatsApp template review recorded".
  - Whoever sent a quote on WhatsApp gets the notice "A quote you sent did not reach the customer on WhatsApp", and the quote's send dialog then says "Not on WhatsApp: this company has no approved WhatsApp template for quotes yet."
  - In a chat, a template message that waited to go shows **Not sent** with "The template is not approved."; the composer offers approved templates only.
- **Who acts:** the Executive (the only role that changes the templates screen), with the person who manages the companies' WhatsApp account in Meta (the developer, in the group's Meta account, until the final phase); the sales team lead tells the callers.
1. In Meta's WhatsApp Manager › **Message templates**, read the template's status and the reason Meta gives.
2. Change the wording as the reason asks and send it for review again under the **same name and language**: the app records Meta's new answer by itself, with nothing to do in the app. Keep the name: the app has no screen that adds a template, so a template under a new name waits for the developer.
3. Meanwhile, for a customer update (the quote, the confirmed order), an Executive may choose another approved template of the company under **Settings › WhatsApp templates** › **Customer updates** (the list offers only templates with the right blanks and buttons) and press **Save**, or untick **Send this update to customers** so nothing more is held.
4. For each quote named in a notice: open the quote › **Quote document** › **Open the document**, and give it to the customer by email or by hand. An update held while its template was not approved is never sent later, and the same quote does not go on WhatsApp a second time.
5. The welcome turned down: a customer's first message gets no welcome (no AI notice, no "reply HUMAN"), and people answer as usual. The stop confirmation turned down: a STOP is still recorded and honoured; only its confirmation does not go.
- **Meanwhile:** inside a customer's 24-hour window people reply in free text as usual, which needs no template. Outside it, only approved templates can be sent ("The customer last wrote more than 24 hours ago. Send an approved template."). A customer whose update was held receives nothing in its place.
- **When it is approved again:** the template's **Review** reads **Approved** and **Templates turned down** goes back down; the next quote sent on WhatsApp shows **Sent**, then **Delivered**, in the customer's chat.

## 14. The WhatsApp messaging limit is reached
Meta limits how many new chats the four companies may start in a rolling 24 hours, across all their numbers: a template sent to a customer whose 24-hour window is closed starts one, and a customer counts once a day however many messages they get. The app counts against the limit Meta last reported (250 until Meta reports one). From 80 % of the limit, offers (marketing templates) wait; at the limit, every other message that would start a chat is refused. A chat the customer wrote in during the last 24 hours never counts, so replies always go ([phase 2 design §6.1](../03-roadmap-appendix/phase2.md#61-w1-whatsapp-threads-and-messaging)).
- **What it looks like:**
  - Sentry: `whatsapp.budget_high` when 80 % is used; `whatsapp.quality_low` when a number's quality falls to Low.
  - **Admin › Integration health** › **WhatsApp**: "{used} of today's {limit} new chats started by the companies are used.", each company's **Quality** (High, Medium, Low), and under **Messages not sent in the last 24 hours** the count for "Today's WhatsApp limit was reached."
  - In a chat, an offer stays **Waiting to send**; any other template to a customer whose window is closed shows **Not sent** with "Today's WhatsApp limit was reached."
- **Who acts:** the Executive reads the page and tells the sales team lead, who tells the team.
1. On **Admin › Integration health** › **WhatsApp**, read how much is used, and each number's quality. Meta's WhatsApp Manager shows the same limit and quality per number.
2. For the rest of the day, start no new chats: hold offers and template follow-ups, answer only the chats customers wrote in, and reach the customers whose message was not sent by phone from the Cold Caller or Converting workspace.
3. A quote sent on WhatsApp to a customer whose window is closed is refused at the limit, and its sender gets no notice: check the customer's chat after sending, and when it shows **Not sent**, give the customer the quote from **Quote document** › **Open the document** by email or by hand.
4. Quality at Low: the app sends as before, but Meta may lower the limit while a number's quality stays low. Stop offers on that company's number and look at what it sent in the last days (customers block or report a number for messages they did not want); tell the developer.
- **Meanwhile:** customers who write get replies as usual. Customers outside an open chat get nothing new that day. An offer held at 80 % stays **Waiting to send** and is not sent later by itself; a refused message is not tried again.
- **When it clears:** the count is a rolling 24 hours, so room comes back hour by hour as the oldest chats leave it, and the line on Integration health falls below the limit. Send the refused messages again by hand from each chat; a held offer still listed **Waiting to send** is sent again the same way. Check that the next template to a customer whose window is closed shows **Sent**.

## 15. Exotel is down
Exotel places the calls made from the screen, brings in calls to each company's incoming-call and missed-call numbers, and sends each call's progress and its recording ([phase 2 design §6.3](../03-roadmap-appendix/phase2.md#63-t3-click-to-dial-and-recordings) and [§7.4](../03-roadmap-appendix/phase2.md#74-t4-inbound-calls-and-screen-pop)). While it is down, callers dial by hand and save each call as before.
- **What it looks like:**
  - On the screen: §12's signs.
  - Sentry: `webhooks.failing` when Exotel's messages fail to be handled, `webhooks.backlog` when they wait too long; a refused call's `action.failed` line.
  - **Admin › Integration health** › **Messages from other systems**: **Call updates** and **Incoming calls** stop counting new messages in calling hours; a recording that could not be copied ends under **Messages that failed** with "It failed ten times".
  - Exotel's status page.
- **Who acts:** callers and the sales team lead keep calling; the Executive watches Integration health; the developer follows the outage with Exotel.
1. Callers dial by hand as §12 says: **Show number** (`D`), their own phone, then an outcome key; reload the page first when a call bar still shows **Placing the call**. A call saved this way is recorded as dialled by hand, counts as an attempt as before, and keeps the calling hours, consent and do-not-disturb rules: the number is not shown outside 9 AM to 9 PM, to a customer who withdrew consent, or for a sales call to a number on the do-not-disturb list.
2. Leave the company's numbers as they are in Settings › Companies › **Numbers**: **Take out of use** cannot be undone (the number has to be added again), and no switch turns calling from the screen off for a day; telling the team is enough.
3. Incoming calls: while Exotel is down nothing reaches the app, so no customer pops up on screen and no missed call becomes a lead or a callback. When Exotel is back, the sales team lead reads the missed calls of the outage from Exotel's own call log, if Exotel kept them, and gives each one to a caller as a lead. Calls Exotel sends late are handled as usual, with their callbacks made then.
4. Recordings: calls placed from the screen go out unrecorded until each company's Exotel flow plays the recording notice ([STATUS](../10-status.md)). Once they are recorded, a recording that could not be copied is tried again for about two and a half hours; after ten tries it is listed under **Messages that failed**, and the Executive presses **Process again** once Exotel is back.
- **Meanwhile:** customers see the caller's own mobile number instead of the company's calling number, and a customer who calls a company's number gets whatever Exotel answers during its outage. Nothing saved by hand is lost.
- **When it is back:** **Call** works again; reload any lead whose call bar still shows an open call. Place one call from the screen and check that it rings and its outcome saves. On **Integration health**, **Call updates** count again, **Waiting** is 0 with no **Waiting since**, and nothing new is under **Messages that failed**.

## 16. LiveKit is down: type instead of talking
Talk to Shakti (`/voice`, for Executives and General Managers) runs in a LiveKit room ([phase 2 design §7.5](../03-roadmap-appendix/phase2.md#75-v2-live-voice-teach-and-ask)). Its push-to-talk button and its text box also run inside that room, so while LiveKit is down none of the three works; the written way is **Ask the Business** (`/ask`), which answers the same questions from the same records.
- **What it looks like:**
  - Starting a talk says "Talking to Shakti is not set up yet. Type your question in Ask the Business for now." (the room could not be made; Sentry and Vercel › **Logs** get `voice.room_failed`), or "Shakti could not join the talk. Check your network, then start again."
  - During a talk: "The connection dropped. Joining the talk again…", then "The connection was lost, so this talk ended. Start again when your network is back."
  - **Admin › Integration health** › **Messages from other systems**: **Voice sessions** stops counting new messages. LiveKit's status page shows the outage. No alert names LiveKit.
- **Who acts:** the Executive or General Manager using it; the developer follows the outage in LiveKit Cloud.
1. Ask in writing on **Ask the Business**. Teach waits: meanwhile a rule for the Playbook can be written with **New rule** on **Knowledge › Playbook**.
2. Do not start talk after talk: after 10 starts in 5 minutes the start is refused for a while. A start that failed counts no minutes against the day.
3. The developer checks LiveKit Cloud's status page and the project's dashboard. There is no switch that turns Talk to Shakti off; it stays as it is and is tried again later.
- **Meanwhile:** customers are not affected; voice is for staff only.
- **When it is back:** a new talk starts, **What Shakti is doing** reads **Listening** and **What was said** follows the talk. On **Integration health**, **Voice sessions** counts again and nothing is under **Messages that failed**; the minutes of a talk, recorded from LiveKit's messages, show in the minutes left today on `/voice` after it ends.

## 17. The speech service is down
Sarvam AI turns speech into text and text into speech; no second speech service is connected yet ([voice §6](../04-architecture-appendix/voice.md#6-speech-vendors)). It serves Talk to Shakti, recordings filed in the Knowledge Vault (when `KNOWLEDGE_TRANSCRIBE=on`) and the Co-pilot's call transcripts (when `CALL_TRANSCRIBE=on`, off today).
- **What it looks like:**
  - In a talk, Shakti says "Network kamzor hai. Button dabakar boliye, ya screen par likh dijiye." and the screen shows "The connection is weak. Hold the button to speak, or type below." The words blame the network, but the cause can be the speech service. While it is down, holding the button does nothing either, since push-to-talk uses the same service; typing works. When only speaking back fails, answers go on as captions, with no message.
  - The voice worker's log, where it runs: `voice.stt_open_failed`, `voice.stt_failed`, `voice.tts_open_failed`, `voice.tts_failed`.
  - On **Knowledge**, an audio file stays **Being read** with "The recording is being turned into text. The transcript shows here when it is ready."; after its tries run out, the update is listed under **Admin › Integration health** › **Held-back updates**.
  - Sarvam AI's status page.
- **Who acts:** the Executive or General Manager in a talk; whoever filed the recording; the Executive for **Send again**; the developer follows the outage with Sarvam.
1. In a talk, type in **Type instead**, or ask on **Ask the Business**.
2. Recordings in the Knowledge Vault wait and are tried again by themselves. Once the service is back, press **Read again** on a file still **Being read** (it shows after six minutes), or the Executive presses **Send again** on its held-back update. A recording read again part way through is paid for again.
3. Call transcripts: calls are saved as usual; a transcript and the Co-pilot's summary of it come late, and an update held back after its tries is sent again the same way. No screen marks a transcript that failed.
- **Meanwhile:** customers are not affected.
- **When it is back:** a new talk reads **Listening** and shows what is said under **What was said**; an audio file filed in the Knowledge Vault reaches its transcript; **Held-back updates** shows none of these updates.

## 18. The AI provider is down: people take the chats
When Anthropic's service fails (§8 for the signs on Admin › Agents), every agent stops proposing: the WhatsApp Concierge, the Caller Co-pilot, the Triage agent, Ask the Business and the answers of Talk to Shakti. Automatic is not available until Phase 6, so no agent sends anything to a customer or changes a record without a person; the work goes on with people.
- **What it looks like:**
  - No alert names an outage of the service (`ai.spend_high` is about spend). In Vercel › **Logs**, `ai.breaker_opened` (calls paused for a minute after five failures in a minute); **Admin › Agents** still shows each agent **Running**.
  - **Admin › Activity log**: runs end with "AI service not available".
  - No new suggestions reach the **Agent Inbox**, and the Concierge's drafts stop appearing in the chats.
  - The Co-pilot panel stays on "No brief for this lead yet."; **Ask for a brief** comes back after about a minute with no brief.
  - **Ask the Business** says "Something went wrong on our side. Please try again in a minute." or "The service took too long to answer. Try again in a few minutes."
  - Talk to Shakti answers "Abhi jawab nahi mil paya. Thodi der baad dobara poochiye."
  - Anthropic's status page shows the outage.
- **Who acts:** an Executive or a General Manager stops the Concierge; everyone who answers WhatsApp takes the chats; the sales team lead tells the callers.
1. Confirm the outage on Anthropic's status page.
2. On **Admin › Agents**, press **Stop** for the Concierge (or **Stop all agents**). A failing service alone does not hand a chat to people; once the Concierge is stopped, a new chat starts with people, and the next customer message on a chat the assistant held hands it to people ("The assistant was not available" in its history).
3. People take the chats: **Messages** (`/messages`) lists the chats waiting for a reply, and the composer works without taking over. Press **Take over chat** on each chat the assistant still holds, so it drafts nothing there when the service is back. A chat left 10 minutes in calling hours sends its person "A WhatsApp customer is waiting for your reply".
4. Callers carry on from the call log and the chat; nothing in calling waits for the Co-pilot.
5. Leave autonomy and the spending limits as they are; runs that failed are recorded as unavailable and nothing is run again by hand.
- **Meanwhile:** customers get people's replies, more slowly; the welcome on a customer's first message still goes, since it is sent by the messaging system, not by the agent. No assistant draft reaches a customer without a person in any setting today.
- **When it is back:** on **Admin › Agents** press **Let it run** for the Concierge (or **Let all agents run**). Chats handed to people stay with people until someone presses **Give back to assistant** on each. Check that the **Admin › Activity log** shows new runs without "AI service not available", that **Integration health** › **AI spend** shows **Spent today** rising, that a question on **Ask the Business** is answered, and that **Ask for a brief** gives a brief.
