# Quote state machine

<!-- Generated from packages/domain/src/state-machines by `pnpm --filter @shakti/domain machines:docs`. Do not edit by hand. -->

`quotes.state`. Lines snapshot Price Master prices and the tax-rate version at creation.

Sources: docs/design/backend-weeks-3-5.md §7.3; docs/design/phase1.md §7.3; BLUEPRINT §8.3; PRD SAL-03, SAL-04, SAL-05.

Every state and transition comes from the governing documents.

## States

| State | Kind | Notes |
|---|---|---|
| `draft` | initial | – |
| `sent` | – | – |
| `accepted` | terminal | – |
| `expired` | – | Past `valid_until`; only a re-quote at current prices continues the sale. |
| `superseded` | terminal | Replaced by a newer quote; the old one is kept in `quote_versions`. |
| `withdrawn` | terminal | – |

## Transitions

| Event | From → To | Permitted actor | Guard | Effects | Emits |
|---|---|---|---|---|---|
| `create` | (new) → `draft` | `sales.quote.create` | the customer has a price tier (their own, else the workshop map by customer type) and a live price list exists for the tier in the company or the group; sizing is complete for the pump and rooftop segments; the pump runs inside its curve (pump segment); the sanctioned-load and DCR rules are met where they apply (rooftop subsidy) | `price_lines`: lines priced from the price list (never from input); `compute_tax`: tax computed by the tax engine and snapshotted per line; `set_valid_until`: `valid_until` = created date + 15 calendar days, end of day IST; `number`: `quote_no` from the series | `sales.quote.created` |
| `send` | `draft` → `sent` | `sales.quote.send` | the PDF is rendered; now ≤ `valid_until` (acceptance after expiry answers `quote_expired` and the app offers a re-quote) | `whatsapp_dispatch`: send the PDF on WhatsApp (worker on the event) | `sales.quote.sent` |
| `accept` | `sent` → `accepted` | `sales.quote.send` or the platform | now ≤ `valid_until` (acceptance after expiry answers `quote_expired` and the app offers a re-quote); `accepted_via` is recorded (WhatsApp reply, WhatsApp OTP or signed upload) | `create_order_draft`: create the sales order draft | – |
| `expire` | `draft`, `sent` → `expired` | the platform only | now > `valid_until` | – | `sales.quote.expired` |
| `requote` | `draft`, `sent`, `expired` → `superseded` | `sales.quote.create` | – | `new_quote`: a new quote at current prices and current tax rates; `snapshot_version`: `quote_versions` snapshot of the old quote | `sales.quote.superseded` |
| `withdraw` | `draft`, `sent` → `withdrawn` | `sales.quote.send` | a reason is given | – | `sales.quote.withdrawn` |

Any other event, or an event from a state not listed for it, answers `conflict` with reason `quote_transition_not_allowed`. A guard that refuses answers its own reason; the permission check answers `forbidden`. The command writes the new state to `quotes.state` and the time to `quotes.state_changed_at` when the state changes, applies the effects and calls `ctx.audit()`, and emits the event in the *Emits* column ([event catalogue](../data/EVENTS.md)).

## Notes

- `expire`: A daily job, plus a lazy check when the quote is read.

## Diagram

```mermaid
stateDiagram-v2
  [*] --> draft : create
  draft --> sent : send
  sent --> accepted : accept
  draft --> expired : expire
  sent --> expired : expire
  draft --> superseded : requote
  sent --> superseded : requote
  expired --> superseded : requote
  draft --> withdrawn : withdraw
  sent --> withdrawn : withdraw
  accepted --> [*]
  superseded --> [*]
  withdrawn --> [*]
```
