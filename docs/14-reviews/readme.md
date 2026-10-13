# Reviews

Dated reviews of the code and the documents. Each is a record of what was found and fixed at its commit; it is not updated as the code moves on, except for a later note that carries its date and pull request, or a banner at the top that says what has been resolved since. Dates are in IST. The current state is in [STATUS](../10-status.md).

| Review | What it is | Date | Record or living |
|---|---|---|---|
| [2026-09-backend-review-phase0.md](2026-09-backend-review-phase0.md) | Reviews 1 and 2: the backend of Phase 0 weeks 1 and 2 (schema, RLS, the command runner, contracts), then a tool-assisted pass | 27-09-2026, the first of the day | Record, with later notes marked Fixed or Changed |
| [2026-09-review3-audit.md](2026-09-review3-audit.md) | Review 3: a full audit of Phase 0 through week 3 slice 1, at commit `8a9b829` | 27-09-2026, after reviews 1 and 2 | Record, with later notes marked Fixed or Changed |
| [2026-09-audit.md](2026-09-audit.md) | The production-readiness audit: 108 findings by severity (C, H, M and L numbers), the fix plan and their resolution in pull requests #5 to #25 | 27-09-2026, after review 3 | Record, with a banner on its resolution; §8 points to STATUS for the owner's actions |
| [2026-10-audit.md](2026-10-audit.md) | The Phase 0–1 audit: six areas scored, every finding verified by a skeptic, and the fix batches | 12-10-2026 to 13-10-2026 | Record; each batch's run file records its fixes |

Slice reviews of Phase 1 are kept with each slice's run notes in `docs/runs/phase1/`.
