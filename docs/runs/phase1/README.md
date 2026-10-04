# Phase 1 run files

One file per slice in flight, `docs/runs/phase1/<slug>.md`, so a cloud session or an agent on the PC finds everything it needs in the repository. The file reaches the slice's branch with `main` (or by a commit of the lead session's), is updated on that branch while the slice runs, and returns to `main` with the slice's merge. Where each slice stands in one line is in [STATUS](../../STATUS.md) (In progress); how work moves between the cloud and the PC is in [hybrid](../../runbooks/hybrid.md); the steps from a brief to `main` are in [slice-integration](../../runbooks/slice-integration.md).

## What a run file holds
- **Brief:** what the slice builds, the design section, what it may and may not touch, and when it is done. The lead session writes it; the rules every builder follows are in [`.claude/agents/slice-builder.md`](../../../.claude/agents/slice-builder.md) and the definition of done in [AGENTS §10](../../../AGENTS.md#10-definition-of-done), so a brief never repeats them.
- **Report:** the builder's report at the end of each run, newest first, dated: what it built, the tests and counts, each check's summary line, `EXPLAIN` evidence, what is unfinished, the decisions the brief did not settle.
- **Review:** the reviewer's findings, ranked, each marked fixed or open with the commit that fixed it.
- **Integration notes:** what the merge with `main` must do beyond the usual steps (wiring, migrations to renumber, baselines to make, measurements after the merge).

When the slice merges, its file stays on `main` as the record of the run, with the pull request number in its header.

## Template
```markdown
# <code> <name> (wave <n>)

| | |
|---|---|
| Branch | `feat/<...>` on GitHub (the branch a cloud session starts on) |
| PC worktree | `<slug>`, slot <n>: Postgres <port>, app <port> |
| Runs on | cloud or PC |
| State | brief / building / built / reviewed / fixed / integrating / merged (#N) |
| Next step | one line |

## Brief
Design: `docs/design/phase1.md` §<x>. What to build, numbered. Files owned; files another slice owns.
Done when: the slice-specific checks beyond AGENTS §10.

## Report
### DD-MM-YYYY, <who>

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
```

## Ports on the PC
Each slice on the PC takes a slot, and the slot gives its Postgres and app ports ([slice-integration §1](../../runbooks/slice-integration.md#1-machines-and-ports)); the run file's header records it. A cloud session uses the defaults of its own VM (Postgres 54322, app 3000).

## Slices in flight
- [P4 print and letterhead](p4-print.md)
- [C3 pipelines, scoring and referrals](c3-pipelines.md)
- [C4 sizing](c4-sizing.md)
- [P2b imports upgrade](p2b-imports.md)
- [AI0 agent runtime and Inbox](ai0-agent-runtime.md)
