# ADR 0019 — Files in S3 under SSE-KMS, scanned by GuardDuty, and fields sealed with KMS data keys

**Status:** Accepted: approved by the owner within the Phase 1 design, 29-09-2026 (`docs/design/phase1.md` §5.3); built in #85 (migrations 0065 and 0066) · **Date:** 29-09-2026 · **Deciders:** Owner, within the Phase 1 design · **Blueprint:** §5, §7.5, §7.10 · **Architecture:** §9 · **Security:** §5, §8 · **Database:** §6.10 · **ADR:** 0005, 0009

## Context
Phase 1 stores files people upload (company logos and letterheads, signed quotes, consent proof, import workbooks) and files the BOS makes (quote PDFs), and later phases add site photos, receipts, recordings and identity documents. Blueprint §5 places object storage in AWS `ap-south-1`. Uploaded bytes are untrusted: they may carry malware, scripts in a PDF or personal data in image metadata, and nothing may read them before they are checked. Bank details printed on documents must be stored encrypted, with decryption only where a document is printed or a payment made (SECURITY §5). The BOS runs on Vercel functions, which have small request bodies and no resident process.

## Decision
**One S3 bucket per environment, encrypted with the environment's KMS key; bytes go straight between the browser and S3 on short pre-signed URLs; GuardDuty Malware Protection scans every new object; and the same KMS key wraps the data keys that seal sensitive fields.**

- `infra/aws/files.yaml` (one CloudFormation stack per environment) creates the KMS key with rotation, the bucket (versioned, public access blocked, owner enforced, TLS only, encrypted by default with the key, browser uploads from the environment's own address only, earlier versions and unfinished uploads expiring after a day), the GuardDuty Malware Protection plan that tags each new object, and the app's IAM user.
- `files.upload.begin` checks the purpose's permission and limits and records the file as `pending`; the web layer signs a PUT for 15 minutes with the type, length, SHA-256 and encryption bound into the signature; `files.upload.complete` compares what S3 holds with what was declared and emits `files.file.uploaded`.
- The worker of `files.file.uploaded` runs as `system:workers` with `files.process` and moves the file through the `file_upload` machine: GuardDuty's `GuardDutyMalwareScanStatus` tag (`NO_THREATS_FOUND` passes; no tag yet is retried; anything else rejects), then image re-encoding, the PDF check and, for vault photos, OCR masking (ARCHITECTURE §9). A file is readable only once `ready`, through a 15-minute pre-signed GET.
- `FieldCipher` (`packages/domain/src/privacy/field-cipher.ts`) seals a value with AES-256-GCM under its own data key, binding the table, column, company and row as additional data; the data key comes from KMS `GenerateDataKey` with the same four as the encryption context (`apps/web/src/crypto/kms-cipher.ts`). A developer's machine and CI use `FIELD_ENCRYPTION_KEY` instead, which a hosted runtime refuses.
- Locally, `localDiskFileStore` stands in for S3 behind the same `FileStore` port, and a file no scanner saw is accepted only where nothing is hosted (`not_scanned`).

## Consequences
- An upload's bytes go from the browser to S3 without passing through a Vercel function, and the 15-minute URLs bind exactly the bytes declared, so a different file cannot be swapped in. Import workbooks still reach their server action directly and join this flow with the imports upgrade (P2b).
- The scan is asynchronous: an upload is usable a short time after it lands, and the uploader says so in words. A file that waits too long is listed on Integration Health and can be sent back to its checks.
- A sealed value copied to another column, row or company opens neither there nor in KMS, because the encryption context differs.
- Each environment's stack is a manual step for the owner with AWS access, and the app's keys go into the environment's Vercel project; until then a hosted runtime answers uploads with `files_unavailable`.
- GuardDuty charges per object scanned and KMS per request; both sit in the AWS line of the vendor quotes (`docs/phase0/vendor-quotes.md` §3.4).
