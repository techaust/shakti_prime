# ADR 0013 — Read-only Tally connector with AlterID reads and deletion tombstones

**Status:** Proposed (2026-09-27; to be confirmed by the Tally discovery visit and the connector spike, `docs/spikes/tally.md`, which waits for the visit and a Tally instance) · **Blueprint:** §1, §4, §7.10, §8.8, §10, §12, §16, §17, §18 (risk 2) · **Architecture:** §2, §7 · **API:** §2, §3.5 · **Database:** §4.3, §6.7 · **Security:** §2 (connector signing), §9 (the client PC) · **PRD:** FIN-02

## Context
Tally Prime is the group's statutory ledger, one Tally company per selling entity, running on a PC in the Jaipur office. The BOS needs Tally's sales, receipt and credit-note vouchers to update payment milestones, dealer outstanding and reconciliation, and its purchase vouchers for job costing, without ever changing Tally's books. Tally exposes an XML interface on the local network only, has no push mechanism, slows down under heavy reads, and lets users alter or delete vouchers at any time. The office internet link and the PC can be down for days.

## Decision
**A Windows service beside Tally (`apps/tally-connector`, Node and TypeScript) reads Tally and pushes signed batches outbound to the BOS. The BOS never writes to Tally.**

- **Reads by AlterID:** per company, the connector asks Tally for vouchers and ledgers whose AlterID is above the last one the BOS accepted (`GET /connector/tally/cursor`), so each read is incremental and resumable.
- **Throttled, sequential processing:** one company and one request at a time, small pages and a pause between requests, so Tally stays responsive for Accounts.
- **Local SQLite outbox:** each batch is written to a local SQLite queue before sending and removed only after the BOS acknowledges it, so a network or BOS outage loses nothing; the connector catches up after an outage (tested with a simulated 3-day outage).
- **Idempotency by GUID:** every voucher and ledger is keyed by Tally's GUID and each batch carries an `Idempotency-Key`; a batch names its AlterID range (`fromAlterId`, `maxAlterId`) and the server refuses a gap or an overlap (`cursor_mismatch`). An altered voucher arrives again with a higher AlterID and replaces its earlier reading.
- **Daily GUID snapshot → tombstones:** once a day the connector sends every voucher GUID per company (`POST /connector/tally/snapshot`). A voucher the BOS holds that is missing from the snapshot becomes a row in `tally_voucher_tombstones`, which reverses its effect on milestones, outstanding and reconciliation and appears in the review queue; nothing is deleted.
- **Restricted purchase data:** purchase and debit-note vouchers land in `tally_purchase_vouchers`, readable only with `procurement.rate.read`.
- **Heartbeat:** every 5 minutes with versions, reachability and queue depth (`POST /connector/tally/heartbeat`); 30 minutes of silence raises an alert, and the version and last sync time show on Integration Health.
- **Signed self-update:** the connector polls `GET /connector/release` and installs a release only when its CI signature verifies with the release key shipped in the installer and its SHA-256 matches.
- **HMAC authentication:** a per-connector key signs every request with HMAC-SHA256 over method, path, timestamp and body hash (`connectorSigningString()`), with a 5-minute clock-skew window; the key is kept in the connector's encrypted local configuration, rotated every 6 months, and revocable from the BOS.

## Consequences
- Tally stays the single statutory authority; the BOS mirrors it and never needs Tally write access or an inbound firewall opening at the office.
- The connector is a client-site component to install, monitor and update; self-update and the heartbeat keep that to exceptions, and the runbook covers a connector offline.
- Deletions are handled without trusting Tally to report them; a day's delay before a deleted voucher is reversed is accepted.
- Reconciliation quality depends on Tally practice (Buyer Order No., GSTIN on parties); unmatched vouchers go to the review queue, and the discovery visit fixes the rules per company.
- Tally's XML limits and company setup are the main unknowns (blueprint risk 2); the connector spike (`docs/spikes/tally.md`) is to prove AlterID reads, deletion detection and a signed push against the client's real Tally version.
