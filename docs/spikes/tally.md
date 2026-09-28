# Spike: Tally, the BOS side

**Status:** ready to run. The BOS-side rules and request signing are built and tested with fixtures; nothing has read a real Tally company yet.
**Roadmap:** §2 week 6 · **Blueprint:** §8.8, §10 · **API:** §2 (connector signing), §3.5 · **Rule:** the BOS never writes to Tally

## 1. What is built
| Piece | Where |
|---|---|
| Batch rule: a company's AlterID cursor only moves forward; the newest version of each GUID in a batch wins; GUIDs at or below the cursor are resends and skipped; a batch whose maximum is below the cursor is refused (a restored company or copied data folder) | `packages/domain/src/tally/sync-rules.ts` (`checkBatch`) |
| Snapshot rule: stored, live vouchers older than the snapshot and absent from it become tombstones; GUIDs the BOS never received are listed for a resend; a tombstoned voucher that reappears goes to review; a snapshot that would remove more than 10 % of a company (and more than 20 vouchers) is refused for a person to confirm | `diffSnapshot` in the same file |
| Heartbeat rule: every 5 minutes; `late` after two missed beats; `silent` at 30 minutes, which raises one alert per silence | `connectorHealth`, `shouldAlertSilence` |
| Request signing built with the published connector contract (`connectorSigningString()`, `isConnectorTimestampFresh()`, `ConnectorHeaders`): `X-Connector-Id` (a UUID), `X-Timestamp` (Unix seconds, ten digits), `X-Signature` (lowercase hex HMAC-SHA256) over `METHOD\nPATH?QUERY\nTIMESTAMP\nhex(SHA-256(body))`; 5-minute skew either way; two keys per connector during a rotation; constant-time compare | `apps/web/src/integrations/tally/signature.ts` |
| Heartbeat, batch and snapshot read as untrusted input through the published connector contract (`packages/contracts/src/api/connector.ts`): at most 500 vouchers, a batch from the server's cursor (`fromAlterId`) to `maxAlterId` with every row inside that range and each GUID once, amounts as two-decimal strings (`SignedMoneySchema` for ledger sides); purchase and debit-note vouchers are the restricted ones for `tally_purchase_vouchers` | `apps/web/src/integrations/tally/payloads.ts` |
| A spike-only reader of Tally's XML server (vouchers after an AlterID, the GUID snapshot) standing in for the connector | `apps/web/src/integrations/tally/tally-xml.ts` |
| Fixture tests (signing and skew, tampering, rotation, payload problems, XML export, the fixture through the cursor and snapshot rules) | `apps/web/src/integrations/tally/tally.test.ts`, `packages/domain/src/tally/sync-rules.test.ts` |
| Spike script | `apps/web/scripts/spike/tally-read.ts`, run with `pnpm --filter web spike:tally` |

Not built, by design: the `/api/v1/connector/tally/*` routes and every table they would write (`tally_vouchers`, `tally_purchase_vouchers`, tombstones, heartbeats, connectors and their keys) belong to Phase 5; no migration is added. The Windows connector (`apps/tally-connector`) is Phase 5.

## 2. What the user supplies
1. The **Tally discovery visit** (ROADMAP §10): the Tally Prime version, the companies and which entity each belongs to, whether "Buyer Order No." is filled on sales vouchers, and how cancellations and deletions are done in practice.
2. A **copy of one company** (restored backup) on a Windows machine with Tally Prime running and its XML server enabled on port 9000 (F1 › Settings › Connectivity › "TallyPrime acts as Server"). Never the live books.
3. Access to run the script on that machine or one on the same network: `TALLY_URL` (for example `http://localhost:9000`), `TALLY_COMPANY` (the exact company name), `TALLY_ENTITY_CODE` (`SS`, `SMP`, `ASH` or `RCREF`), `TALLY_CONNECTOR_ID` (a UUID) and `TALLY_CONNECTOR_KEY` (a spike key of at least 32 random characters, generated there), optionally `TALLY_SPIKE_SINCE` (an AlterID; default 0 reads everything).

## 3. Steps
1. `pnpm --filter web spike:tally` with `TALLY_SPIKE_SINCE=0`: reads every voucher, batches them, verifies a signed batch and reads the GUID snapshot. Expect zero tombstones and zero missing on a full read.
2. In the Tally copy: alter one voucher, delete one, cancel one. Run again with `TALLY_SPIKE_SINCE` set to the cursor printed by the first run: the altered voucher comes back with a higher AlterID; the deleted one appears only as a tombstone when a stored list is compared (step 1's read against the new snapshot); record how Tally reports the cancelled one (`ISCANCELLED` or removal).
3. Record read time and size for the full company and for an incremental read, and confirm the field names (`BASICBUYERORDERNO`, `PARTYGSTIN`, `ALLLEDGERENTRIES.LIST` and `ALLINVENTORYENTRIES.LIST` in particular) against the real export; adjust `tally-xml.ts` if they differ.
4. Save the reports under `docs/spikes/tally/` with the date and record the results below.

## 4. Pass criteria
- Incremental read by AlterID returns exactly the vouchers changed since the cursor.
- The daily snapshot detects a deleted voucher as a tombstone and never tombstones a voucher created after the snapshot.
- A signed batch verifies; a changed body, path or a timestamp more than 5 minutes off does not.
- The full-company read and snapshot finish within the connector's nightly window (record the times; the connector throttles reads sequentially).
- A heartbeat silence of 30 minutes raises exactly one alert (covered by tests; the live check comes with the connector).

## 5. Results
Not run yet.
