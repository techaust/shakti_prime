# The Tally connector

A Windows service beside Tally Prime that reads each mapped Tally company by AlterID and pushes signed batches to the BOS ([ADR 0013](../../docs/adr/0013-read-only-tally-connector.md), [the Phase 5 design §6.2](../../docs/03-roadmap-appendix/phase5.md#62-tc1-the-tally-connector)). It never changes Tally: every request is an export.

## How it works

| Part           | File                  | What it does                                                                                                                                                                                                             |
| -------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reader         | `src/tally/reader.ts` | Tally's XML server on `TALLY_URL` (default `http://localhost:9000`): one request at a time, pages of 200 AlterIDs, a pause between requests, timeouts and retries with a doubling wait.                                  |
| Tally's XML    | `src/tally/xml.ts`    | The export requests and the readings of their answers (also used by the web's spike script).                                                                                                                             |
| Outbox         | `src/outbox.ts`       | SQLite through Node's `node:sqlite`: each page is written before it is sent, marked sent on the BOS's answer, kept 7 days.                                                                                               |
| Client         | `src/client.ts`       | `cursor`, `batches`, `snapshot` and `heartbeat`, signed with the connector's key; each batch carries the `Idempotency-Key` stored with it, so a resend after a lost answer is applied once.                              |
| Sync           | `src/sync.ts`         | A cycle: the outbox first, then each company from the BOS's cursor to Tally's last AlterID, then the daily GUID snapshot.                                                                                                |
| Scheduler      | `src/scheduler.ts`    | A heartbeat every 5 minutes on its own timer; a cycle every 2 minutes while the BOS answers; the snapshot after 02:00 India time.                                                                                        |
| Settings       | `src/config.ts`       | The BOS address, the connector's id and key, and the company mapping, in a file sealed with Windows DPAPI to the service's account (`src/dpapi.ts`). A plain file is read only off Windows with `TALLY_CONNECTOR_DEV=1`. |
| Log            | `src/log.ts`          | One JSON line per event, a file per India day, kept 30 days; ids and counts only, never a party name, an amount or the key.                                                                                              |
| Named settings | `src/settings.ts`     | Page sizes, the pause, timeouts, retries, intervals and the snapshot hour.                                                                                                                                               |

The folder holding the settings, the outbox and the logs is `TALLY_CONNECTOR_HOME`, by default `%ProgramData%\ShaktiTallyConnector`.

## Tests

`pnpm --filter @shakti/tally-connector test` runs them against a Tally fixture server (`test/fixture-tally.ts`) and a stub BOS (`test/stub-bos.ts`): paging by AlterID, throttling, a connector process killed mid-batch and restarted, a resend after a lost answer, signing against the BOS's vectors, and a 3-day outage caught up in order. The Windows CI job (`.github/workflows/tally-connector.yml`) runs them on Windows too, with the real DPAPI.

## Building the executable

`node apps/tally-connector/packaging/build-sea.ts` bundles the connector, makes a Node single executable (`packaging/sea-config.json`, `postject` 1.0.0-alpha.6) and checks it answers its version. The Windows CI job builds it with WinSW 2.12.0 (its SHA-256 checked) and `packaging/winsw/shakti-tally-connector-service.xml` into one folder.

## Installing on the office PC (final phase)

1. Make a local Windows account for the service that is not an administrator, for example `ShaktiTally`.
2. Copy the package folder to `C:\Program Files\ShaktiTallyConnector`.
3. In Tally Prime, turn on the XML server on port 9000 (F1, Settings, Connectivity, "TallyPrime acts as Server") and open each company.
4. In the BOS, register the connector in Admin, Integrations, Tally, and keep its id and one-time key at hand.
5. Run the setup under the service's account, so the sealed settings open for the service: `runas /user:.\ShaktiTally "C:\Program Files\ShaktiTallyConnector\shakti-tally-connector.exe setup"`. It asks for the BOS address, the id, the key (nothing shows as it is typed) and each Tally company with its BOS company, then checks that the BOS answers.
6. From an administrator's window: `shakti-tally-connector-service.exe install /p` (give the service's account), then `shakti-tally-connector-service.exe start`.
7. Give only the service's account and Administrators access to `%ProgramData%\ShaktiTallyConnector`: it holds the outbox, whose pages carry voucher details until they are removed.
