# Setting up file storage for an environment

What the owner does, once for dev and once for staging, so the BOS can take uploads (a company's logo and letterhead first, then signed quotes, consent proof and vault documents), seal bank details and send mail from Amazon Web Services in Mumbai. It takes about twenty minutes per environment. Everything is created by one CloudFormation stack from `infra/aws/files.yaml`; nothing is made by hand except the app user's access key.

The stack makes, for the environment named `<env>` (`dev` or `staging`):
- the bucket `shakti-prime-<env>-files`: private, owned by the account, versioned, encrypted with the environment's key, refusing any call without TLS, accepting browser uploads only from `https://shakti-prime-<env>.vercel.app`, dropping an unfinished upload after a day, and removing a replaced or deleted file's earlier version a day after it stops being current;
- the key `alias/shakti-prime-<env>-files`, rotated every year by AWS, which encrypts the files and seals bank details;
- GuardDuty Malware Protection for the bucket, which scans every new file and writes its verdict on the file as a tag, with the role it needs;
- the IAM user `shakti-prime-<env>-app`, allowed only the bucket's files, the key and, once the client's domain is verified, mail from the one sender address;
- a read-only permission for the existing user `claude-shakti` to list the bucket and read its settings, never a file.

## 1. Create the stack
1. Sign in to the AWS console with the account's administrator login and pick **Asia Pacific (Mumbai) ap-south-1** in the region menu at the top right.
2. Open **CloudFormation** (type it in the search bar) › **Create stack** › **With new resources (standard)**.
3. Under *Specify template* choose **Upload a template file**, click **Choose file** and pick `infra/aws/files.yaml` from the repository (on the owner's PC, `D:\BUSINESS\4. CLIENT PROJECTS\SHAKTI PRIME\SOFTWARE\shakti_prime\infra\aws\files.yaml`). Click **Next**.
4. **Stack name:** `shakti-prime-<env>-files`, for example `shakti-prime-dev-files`.
5. **Parameters:**
   - `EnvironmentName`: `dev` or `staging`;
   - `ReadOnlyUserName`: leave `claude-shakti`;
   - `SesIdentity` and `SesFromAddress`: leave empty until the client's domain is verified in SES (section 4).
   Click **Next**.
6. On *Configure stack options* change nothing and click **Next**.
7. On the review page tick **I acknowledge that AWS CloudFormation might create IAM resources with custom names**, then click **Submit**.
8. Wait until the stack shows **CREATE_COMPLETE** (a few minutes; press the refresh button). If it shows **ROLLBACK_COMPLETE**, open the **Events** tab, copy the first red line and send it to the developer; then delete the stack and start again.
9. Open the **Outputs** tab and keep it open: it shows `FilesBucket`, `FilesKmsKeyId` and `AppUserName`.

## 2. Make the app user's access key
1. Open **IAM** › **Users** and click the user named in `AppUserName` (`shakti-prime-<env>-app`).
2. Open the **Security credentials** tab › **Access keys** › **Create access key**.
3. Choose **Application running outside AWS**, click **Next**, leave the description tag empty and click **Create access key**.
4. Keep this page open for the next section. The secret is shown only now; if the page is closed before it is copied, delete the key and make another.

## 3. Put the values in Vercel
1. Open the Vercel project `shakti-prime-<env>` › **Settings** › **Environment Variables**.
2. Add each of these for the **Production** environment (the environment's `main` deployments), pasting the value exactly:
   - `FILES_BUCKET`: the `FilesBucket` output;
   - `FILES_KMS_KEY_ID`: the `FilesKmsKeyId` output;
   - `AWS_ACCESS_KEY_ID`: the access key from section 2;
   - `AWS_SECRET_ACCESS_KEY`: the secret access key from section 2, marked **Sensitive**.
   Do not add `AWS_REGION` (Mumbai is the default) and never add `FIELD_ENCRYPTION_KEY`, which is for developers' machines only: a deployment refuses to start with it.
3. Close the access key page in AWS.
4. Open **Deployments**, find the latest deployment of `main`, open its menu (three dots) and choose **Redeploy**.
5. When it is ready, sign in as an Executive, open **Settings › Companies**, choose **Logo and letterhead** on a company and upload its logo. It shows as *Checking* until the malware scan tags it and the checks finish, a few seconds to a minute, then as the company's current logo.
6. **Files that waited.** The file checks run as soon as a file lands. A file that has waited more than ten minutes (for example one uploaded before the checks were switched on, or one whose checks gave up while the store was unreachable) is listed on **Admin › Integration health** under *Files waiting for their checks*: an Executive presses **Check files again** and the checks run again from where each file stopped, so nothing has to be uploaded again. Once checked, a logo shows as the company's current logo.

## 4. When the client's domain is verified in SES
Mail goes through SES once the client's domain is verified (DKIM, SPF and DMARC) and SES production access is granted: do [§7](#7-verifying-the-clients-domain-for-mail) first.
1. In **CloudFormation**, select the stack › **Update** › **Use existing template** › **Next**.
2. Set `SesIdentity` to the verified domain and `SesFromAddress` to the one sender address on it that the BOS sends from (a `no-reply@` address on the domain). **Next**, **Next**, tick the IAM acknowledgement and **Submit**.
3. In Vercel add `SES_FROM` with the same sender address and change `MAILER` to `ses`, then redeploy. A set-password or reset message now arrives by mail.

## 5. Rotating the access key
Every six months and when someone who saw it leaves (SECURITY §10): make a second access key for the same user (section 2), replace `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in Vercel and redeploy, check an upload works, then in IAM make the old key **Inactive** and, a day later, delete it.

## 6. Removing an environment
The bucket and the key are kept when the stack is deleted, so no file or sealed value is lost by mistake. Empty and delete the bucket, and schedule the key's deletion, only when the environment's data is no longer needed.

## 7. Verifying the client's domain for mail
Once per AWS account, in Mumbai, when the group has its domain and someone who can change its DNS records ([accounts](accounts.md#planned-not-yet-opened)). Until production access is granted, SES sends only to addresses verified in it, so the BOS keeps `MAILER=log` on dev and staging.

1. Sign in to the AWS console with the administrator login, region **Asia Pacific (Mumbai) ap-south-1**, and open **Amazon Simple Email Service** › **Configuration** › **Identities** › **Create identity**.
2. Choose **Domain**, type the group's domain, and under *Verifying your domain* keep **Easy DKIM** with **RSA_2048_BIT**. Tick **Use a custom MAIL FROM domain** and type a subdomain only mail uses (for example `mail.<domain>`). Click **Create identity**.
3. The identity's page lists the DNS records to publish. Send them to whoever runs the domain's DNS, to add exactly as shown:
   - **DKIM:** the three `CNAME` records;
   - **SPF:** the custom MAIL FROM domain's `MX` record and its `TXT` record (`v=spf1 include:amazonses.com ~all`);
   - **DMARC:** a `TXT` record named `_dmarc.<domain>`, starting `v=DMARC1;`, with the policy and report address the group's mail administrator chooses.
4. Wait until the identity shows **Verified** and *DKIM configuration* shows **Successful** (minutes to a day after the records are published; press the refresh button).
5. **Production access:** open **Account dashboard** › **Request production access**. Mail type **Transactional**; the website is the production address; the use case in plain words (set-password, password-reset and account messages to the group's own staff; bounces and complaints kept off by SES's account-level suppression list). Submit; AWS answers by mail, usually within a day.
6. **The sender address:** a `no-reply@<domain>` address on the verified domain. It needs no mailbox; it goes into the stack as `SesFromAddress` and into Vercel as `SES_FROM` (§4).
