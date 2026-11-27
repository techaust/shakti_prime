# Project, standard install flow state machine

<!-- Generated from packages/domain/src/state-machines by `pnpm --filter @shakti/domain machines:docs`. Do not edit by hand. -->

`projects.state` for flow templates of the standard kind; `project_milestones.state` holds each step. Default checklist: survey → dispatch → install → commission → handover.

Sources: BLUEPRINT §8.5, §19 item 2; PRD PRJ-01, PRJ-03.

Items marked *proposed* are not named in the governing documents; they were chosen for this specification and need review.

## States

| State | Kind | Notes |
|---|---|---|
| `active` | initial, *proposed* | – |
| `on_hold` | *proposed* | – |
| `completed` | terminal, *proposed* | – |
| `cancelled` | terminal, *proposed* | – |

## Transitions

| Event | From → To | Permitted actor | Guard | Effects | Emits |
|---|---|---|---|---|---|
| `create` | (new) → `active` | `projects.write` at entity scope or wider or the platform | – | `copy_checklist`: copy the steps of the company's newest flow template for the segment, else the default steps | `projects.project.drafted` |
| `milestone.complete` *(proposed)* | `active` → `active` | `projects.write` | the milestone is the next open one in checklist order; the milestone's required documents are in the vault (PRJ-03) | `mark_milestone`: set the milestone done with `done_at`; `emit`: event for the milestone WhatsApp message | `projects.project.milestone_completed` |
| `hold` *(proposed)* | `active` → `on_hold` | `projects.write` at entity scope or wider | a reason is given | – | `projects.project.held` |
| `resume` *(proposed)* | `on_hold` → `active` | `projects.write` at entity scope or wider | – | – | – |
| `complete` *(proposed)* | `active` → `completed` | `projects.write` at entity scope or wider | every milestone is done | `handover_kit` *(proposed)*: send the handover kit on WhatsApp (J11); `register_warranty` *(proposed)*: register warranty per serial (J11) | `projects.project.completed` |
| `cancel` *(proposed)* | `active`, `on_hold` → `cancelled` | `projects.write` at entity scope or wider | a reason is given | – | `projects.project.cancelled` |

Any other event, or an event from a state not listed for it, answers `conflict` with reason `project_standard_transition_not_allowed`. A guard that refuses answers its own reason; the permission check answers `forbidden`. The command writes the new state to `projects.state` and the time to `projects.state_changed_at` when the state changes, applies the effects and calls `ctx.audit()`, and emits the event in the *Emits* column ([event catalogue](../data/events.md)).

## Notes

- `create`: The platform drafts the project from a confirmed sales order of an install segment with a site (`projects.draft`); a Project Manager or General Manager makes one by hand for any confirmed order.
- `milestone.complete`: A Field Engineer completes the steps of a project they are on (`own`).

## Diagram

```mermaid
stateDiagram-v2
  [*] --> active : create
  active --> active : milestone.complete
  active --> on_hold : hold
  on_hold --> active : resume
  active --> completed : complete
  active --> cancelled : cancel
  on_hold --> cancelled : cancel
  completed --> [*]
  cancelled --> [*]
```
