# Reviews

Dated reviews of the code and the documents. Each is a record of what was found and fixed at its commit; it is not updated as the code moves on, except for a later note that carries its date and pull request. Dates are in IST. The current state is in [STATUS](../STATUS.md).

| Review | What it is | Date | Record or living |
|---|---|---|---|
| [2026-09-backend-review-phase0.md](2026-09-backend-review-phase0.md) | Reviews 1 and 2: the backend of Phase 0 weeks 1 and 2 (schema, RLS, the command runner, contracts), then a tool-assisted pass | 27-09-2026, the first of the day | Record |
| [2026-09-review3-audit.md](2026-09-review3-audit.md) | Review 3: a full audit of Phase 0 through week 3 slice 1, at commit `8a9b829` | 27-09-2026, after reviews 1 and 2 | Record, with one later note (#40) |
| [2026-09-audit.md](2026-09-audit.md) | The production-readiness audit: 108 findings by severity (C, H, M and L numbers), the fix plan and their resolution in pull requests #5 to #25 | 27-09-2026, after review 3 | Record; §8 points to STATUS for the actions still open |

Slice reviews of Phase 1 are kept with each slice's run notes in `docs/runs/phase1/`.
