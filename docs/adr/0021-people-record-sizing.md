# ADR 0021 — Only people record the sizing a quote relies on; agents only suggest

**Status:** Accepted (owner, 30-09-2026); applies from the sizing slice C4, merged in #100 · **Date:** 30-09-2026 · **Deciders:** Owner · **Blueprint:** §1, §8.3, §9.3 · **PRD:** SAL-04 · **Security:** §3.3 · **Design:** `docs/03-roadmap-appendix/phase1.md` §6.7, §7.3 · **ADR:** 0004

## Context
A quote is refused when its lead's sizing is missing or out of bounds (PRD SAL-04, `docs/03-roadmap-appendix/phase1.md` §7.3), so the recorded sizing decides what a customer is offered: the pump, the solar array, the rooftop kW. The calculators are deterministic (CLAUDE.md, "Deterministic core"), but their inputs (borewell depth, water level, distance, monthly units, roof area) come from a conversation or a site visit.

The Sizing agent (`agent:sizing`, SECURITY §3.3) and the voice agent could fill them in from a transcript or a message. A wrong figure recorded by a machine would flow into a quote with nobody having vouched for it.

## Decision
**Only a person records a sizing; an agent, a voice session or the system principal may suggest one, never record it.**

- `crm.sizing.record` needs `crm.lead.write` and is marked `peopleOnly`, and the guard (`checkPerson()` in `packages/domain/src/command/run-command.ts`) accepts only a principal of kind `user` whose role is neither `agent:*` nor `system:*`: an agent, a voice session or `system:workers` is refused with `forbidden`, reason `people_only`, whatever it holds.
- The command works the result out on the server from the measurements (and, for a chosen pump, its curve and rating), records an out-of-bounds result with its reasons rather than refusing it, audits it and emits `crm.sizing.recorded`.
- An agent may only suggest a sizing (autonomy level Suggest, through the Agent Inbox of slice AI0); a person accepts the suggestion by recording the sizing themselves.
- The quote guards read the newest sizing a person recorded (`quoteSizingFacts`, which the quote guards of S1 use); a sizing from an older engine version is answered as stale, to be sized again.

## Consequences
- Every quote rests on figures a named person recorded, visible in the audit trail.
- The Sizing agent cannot be promoted to Automatic for this action, whatever its record of unedited suggestions.
- A voice session cannot record a sizing even for the speaking user, who records it on screen.
- The rule applies from C4, and this ADR, SECURITY §3.3 and the design record it.
