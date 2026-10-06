# Start here — Shakti Prime BOS documents

A guide to the documents: what each one is for, who reads it and in what order. Rules for working in the repository are in [CLAUDE.md](../CLAUDE.md) and [AGENTS.md](../AGENTS.md); the full map with one line per document is the [documentation map in CLAUDE.md](../CLAUDE.md#documentation-map).

**Contents:** [Read order](#read-order) · [The numbered documents](#the-numbered-documents) · [The appendix folders](#the-appendix-folders) · [Other folders](#other-folders) · [Generated files](#generated-files) · [Who reads what](#who-reads-what)

## Read order
1. [CLAUDE.md](../CLAUDE.md): the project's rules and where things live.
2. The relevant section of the [blueprint](01-blueprint.md): it governs on any conflict.
3. The module document for the area ([database](05-database.md), [API](06-api.md), [security](07-security.md), [design system](08-design-system.md), [testing](09-testing.md)).
4. The code.

To see where the project stands, read [10-status.md](10-status.md). To find a word, use the [glossary](12-glossary.md).

## The numbered documents
The numbers follow the order a newcomer reads them: what we are building (01 to 03), how it is built (04 to 09), where it stands (10 to 12), and the people's side (13 and 14).

| Document | What it is for |
|---|---|
| [01-blueprint.md](01-blueprint.md) | Scope, stack, data model and phase order. The source of truth. |
| [02-prd.md](02-prd.md) | Requirements with IDs and acceptance criteria, and the tests that prove them. |
| [03-roadmap.md](03-roadmap.md) | The phases, their exit gates and the parallel workstreams. |
| [04-architecture.md](04-architecture.md) | Runtime parts, the request lifecycle, the command layer, events and integrations, and the index of ADRs. |
| [05-database.md](05-database.md) | Schema conventions, row-level security patterns, the table catalogue, migrations and backups. |
| [06-api.md](06-api.md) | The `/api/v1` conventions, the endpoint catalogue, webhook and connector contracts. |
| [07-security.md](07-security.md) | The threat model, sign-in, the permission catalogue, data protection, AI and telecom compliance. |
| [08-design-system.md](08-design-system.md) | Design tokens, components, theme behaviour, and the rules for every word a user reads. |
| [09-testing.md](09-testing.md) | Test layers, the security suite, what CI runs and how to run tests. |
| [10-status.md](10-status.md) | Where the project stands now. Replaced at the end of each working session. |
| [11-decisions.md](11-decisions.md) | Every owner decision, with its date, and the standing rules in force. |
| [12-glossary.md](12-glossary.md) | Business and technical terms, slice codes and the two families of requirement IDs. |

The history of merged work is in [CHANGELOG.md](../CHANGELOG.md); setup and every command are in [README.md](../README.md).

## The appendix folders
Each holds the detail of the numbered document with the same number.

| Folder | What it holds |
|---|---|
| [03-roadmap-appendix/](03-roadmap-appendix/) | The Phase 1 design (23 slices in six waves) and the backend weeks 3 to 5 design. Read the design before building what it covers. |
| [04-architecture-appendix/](04-architecture-appendix/README.md) | Spike notes: short, measured experiments (print, OCR, imports, lists, Account 360, calling, Exotel, WhatsApp, voice, Tally, Realtime). |
| [13-client-packs/](13-client-packs/README.md) | Documents the Shakti group and the development team work through together: the workshop pack, client actions, the wireframe review, design sign-off, vendor quotes, progress for the client, and the Phase 0 gate checklist. Written in business words. |
| [14-reviews/](14-reviews/README.md) | Dated review notes and the production-readiness audit with its resolution record. |

## Other folders
| Folder | What it holds |
|---|---|
| [adr/](adr/) | Architecture decision records, one file per decision, numbered. The index is in [04-architecture.md](04-architecture.md). |
| [runbooks/](runbooks/) | Procedures: [DEPLOY](runbooks/DEPLOY.md), [INCIDENTS](runbooks/INCIDENTS.md), [slice-integration](runbooks/slice-integration.md), [hybrid](runbooks/hybrid.md) (cloud and PC), [accounts](runbooks/accounts.md), [files-setup](runbooks/files-setup.md), [tooling](runbooks/tooling.md). |
| [runs/phase1/](runs/phase1/README.md) | One run file per slice: its brief, the builder's report, the review and the integration notes. |

## Generated files
Two folders are written by commands from the code and are never edited by hand; a test fails when either is stale.
- [data/](data/): the ERD, the data dictionary and the event catalogue, regenerated with `pnpm db:docs`.
- [state-machines/](state-machines/README.md): one specification per state machine, regenerated with `pnpm --filter @shakti/domain machines:docs`.

## Who reads what
| Reader | Start with |
|---|---|
| The owner | [10-status.md](10-status.md), [11-decisions.md](11-decisions.md), then [13-client-packs/exit-gate-actions.md](13-client-packs/exit-gate-actions.md) for what waits on people. |
| The client's people | [13-client-packs/README.md](13-client-packs/README.md): the progress page, then client actions and the workshop pack. |
| A developer or a coding agent | [CLAUDE.md](../CLAUDE.md), [AGENTS.md](../AGENTS.md), then the read order above. |
| A reviewer | The slice's run file, its design section in [03-roadmap-appendix/phase1.md](03-roadmap-appendix/phase1.md), then the module documents it touches. |
| Whoever runs a deploy or meets an incident | [runbooks/DEPLOY.md](runbooks/DEPLOY.md) and [runbooks/INCIDENTS.md](runbooks/INCIDENTS.md). |

The approved documents state how things are, with no change-log wording: history goes to [CHANGELOG.md](../CHANGELOG.md), decisions to [11-decisions.md](11-decisions.md) and status to [10-status.md](10-status.md).
