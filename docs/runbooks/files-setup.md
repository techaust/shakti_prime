# Setting up file storage for an environment

What the owner does, once for dev and once for staging, so the BOS can take uploads (a company's logo and letterhead first, then signed quotes, consent proof and vault documents), seal bank details and send mail from Amazon Web Services in Mumbai. It takes about twenty minutes per environment. Everything is created by one CloudFormation stack from `infra/aws/files.yaml`; nothing is made by hand except the app user's access key.

The stack makes, for the environment named `<env>` (`dev` or `staging`):
- the bucket `shakti-prime-<env>-files`: private, owned by the account, versioned, encrypted with the environment's key, refusing any call without TLS, accepting browser uploads only from `https://shakti-prime-<env>.vercel.app`, and dropping an unfinished upload after a day;
- the key `alias/shakti-prime-<env>-files`, rotated every year by AWS, which encrypts the files and seals bank details;
- GuardDuty Malware Protection for the bucket, which scans every new file and writes its verdict on the file as a tag, with the role it needs;
- the IAM user `shakti-prime-<env>-app`, allowed only the bucket's files, the key and, once the client's domain is verified, mail from the one sender address;
- a read-only permission for the existing user `claude-shakti` to list the bucket and read its settings, never a file.

## 1. Create the stack
1. Sign in to the AWS console with the account's administrator login and pick **Asia Pacific (Mumbai) ap-south-1** in the region menu at the top right.
2. Open **CloudFormation** (type it in the search bar) › **Create stack** › **With new resources (standard)**.
3. Under *Specify template* choose **Upload a template file**, click **Choose file** and pick `infra/aws/files.yaml` from the repository. Click **Next**.
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
5. When it is ready, sign in as an Executive, open **Settings › Companies**, choose **Logo and letterhead** on a company and upload its logo. The upload itself works as soon as the variables are in place.
6. **Files are checked only once the file checks are switched on.** The developer switches them on after this work is joined with the event workers; until then every upload stays at *Checking* and is not used. When they are switched on, the developer also re-runs the checks for any file still waiting, so nothing has to be uploaded again. From then on a logo shows as *Checking* until the malware scan tags it and the checks finish, then as the company's current logo.

## 4. When the client's domain is verified in SES
Mail goes through SES once the client's domain is verified (DKIM, SPF and DMARC) and SES production access is granted (DEPLOY §1).
1. In **CloudFormation**, select the stack › **Update** › **Use existing template** › **Next**.
2. Set `SesIdentity` to the verified domain and `SesFromAddress` to the one sender address on it that the BOS sends from (a `no-reply@` address on the domain). **Next**, **Next**, tick the IAM acknowledgement and **Submit**.
3. In Vercel add `SES_FROM` with the same sender address and change `MAILER` to `ses`, then redeploy. A set-password or reset message now arrives by mail.

## 5. Rotating the access key
Every six months and when someone who saw it leaves (SECURITY §10): make a second access key for the same user (section 2), replace `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in Vercel and redeploy, check an upload works, then in IAM make the old key **Inactive** and, a day later, delete it.

## 6. Removing an environment
The bucket and the key are kept when the stack is deleted, so no file or sealed value is lost by mistake. Empty and delete the bucket, and schedule the key's deletion, only when the environment's data is no longer needed.
