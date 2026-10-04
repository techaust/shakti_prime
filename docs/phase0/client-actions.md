# What the Shakti group needs to do

Prepared 04-10-2026 · last updated 04-10-2026. For: the owners of the Shakti group and the people they name. Prepared by the development team.

The new system is built in pieces, one after another. Some pieces need something only the group can give: an answer, a file, a signature, an account or a meeting. This page lists each one, who should do it, and which piece of work waits for it. The letters and number in brackets name that piece of work; the [glossary](../GLOSSARY.md#slice-codes) explains them. Where an item has its own pack, the pack says exactly what is needed.

**Reading the tables:**
- **Needed by** names the piece of work that waits for the item. The development team proposes it; the calendar date for each is set with the group in the workshop.
- **State** is where the item stands today: not started, in progress, or done with its date.

What is built so far, in business words, is in [progress-for-client.md](progress-for-client.md).

## 1. Needed now, for the next pieces of work

| # | What to do | Who | Needed by | State | Details |
|---|---|---|---|---|---|
| 1 | Answer the workshop questions in the "Blocking work now" box: tax rates, the document number format, price tiers and lists, pipeline stages, call outcomes, scripts, retry and follow-up rules, the lock period, commissions and dealer credit limits | Owner, sales head, Accounts | Quotes (S1), the calling screen (T1), the handover to converters (T2), orders and dealer credit (S2) | Not started | [Workshop pack](workshop-pack.md) |
| 2 | Confirm how GST is worked out (the state of supply, rounding, the solar 70:30 split) and send five to ten past invoices, with names removed, that the system must reproduce exactly | The group's CA | Quotes (S1) | Not started | Workshop PRICE-5 and PRICE-6 |
| 3 | Send the item list with HSN codes and GST rates, the current price lists and kit prices | Accounts, Owner | Quotes (S1) | Not started | Workshop PRICE-2 to PRICE-4 |
| 4 | Confirm the engineering values the pump and rooftop sizing uses (pipe friction, pump efficiency, sun hours and the others listed) | The group's engineering head | Sizing (C4), which every quote (S1) relies on | Not started | Workshop ENG-1 |
| 5 | Sign off the look of the system: colours, text, spacing and the writing rules | An Executive, with one tele-caller and one field or store person | Before the calling screen (T1) and quotes (S1) are built | Not started | [Design sign-off](design-signoff.md) |
| 6 | Send one or two people per role to a 30 to 40 minute screen review | Owner picks the people | The calling screen (T1), quotes (S1), orders and dealer credit (S2), the converter's screen (L1), the home pages (R1) | Not started | [Screen review](wireframe-review.md) |
| 7 | Send each company's letterhead, logo (with a version for dark backgrounds), bank account and UPI ID | Accounts | Printed quotes (P4, S1) | Not started | Workshop SALE-2 |

## 2. Needed during Phase 1

| # | What to do | Who | Needed by | State | Details |
|---|---|---|---|---|---|
| 8 | Send an export of the current CRM (a few hundred rows to start) and the list of sheets in use, then the full files for the move | Sales head | Customer imports (P2b), the data move and its checks (M1) | Not started | Workshop CRM-4 |
| 9 | Send each dealer's credit limit and credit days per company, and name who enters dealer balances until the Tally link | Accounts | Orders with the credit check (S2) | Not started | Workshop SALE-4 and SALE-6 |
| 10 | Set the targets per caller level and team | Sales head, Owner | Targets and home pages (R1) | Not started | Workshop CALL-6 |
| 11 | Approve the privacy notice, consent wording and call-recording notice, with legal advice, and decide which consents a caller may record and whether consent is per company | Owner | Going live with Phase 1 | Not started | Workshop LAW-1 to LAW-3 |
| 12 | Choose the people for the user acceptance tests per role and the two weeks of running the old sheets and the new system side by side | Owner | The end of Phase 1 (M1) | Not started | [ROADMAP §3](../ROADMAP.md#3-phase-1--mvp-1214-weeks) exit gate |

## 3. Accounts, plans and registrations

These take weeks with outside bodies, so they start now even where the work that needs them comes later.

| # | What to do | Who | Needed by | State | Details |
|---|---|---|---|---|---|
| 13 | Hold every service account in the group's name, with the development team as members: domain, hosting, database, file storage, messaging, calling, AI, app store, code repository, error reports | Owner | Going live (G1) | In progress: error reports already use the group's own account | Workshop ACC-2; [vendor quote pack](vendor-quotes.md) |
| 14 | Approve the vendor quote requests so they can be sent from the group's accounts | Owner | Buying the live plans (G1) | Not started | [Vendor quote pack](vendor-quotes.md) |
| 15 | Buy the live plans: a paid database plan, the paid hosting plan, and a code repository plan that stops untested changes reaching the live system | Owner | Going live (G1) | Not started | The development team names each plan |
| 16 | Give access to the group domain's settings, so system emails are sent from the group's own address | Owner or the person who manages the domain | Password and security emails on the live system (G1) | Not started | |
| 17 | Register all four companies on the telecom consent platform (DLT) and get the promotional (140-series) and service (160-series) calling numbers | Owner | Calling from the system (Phase 2) | Not started | Workshop LAW-4 |
| 18 | Verify the group's Meta business account and give one WhatsApp number per company | Owner | WhatsApp messages and quote acceptance (Phase 2) | Not started | Workshop LAW-4 |
| 19 | Record 20 to 30 short voice samples of Executives speaking as they would to the assistant, in Hindi, Hinglish and English | Executives | The speech test, before Phase 2 | Not started | Workshop LAW-5 |
| 20 | Arrange the Tally visit and a copy of one company's Tally data | Accounts | The Tally test, before Phase 5 | Not started | Workshop FIN-1 |
| 21 | Provide real document photos, with the customers' consent, for the test that hides Aadhaar numbers | Owner, Project manager | Storing customer documents (Phase 4) | Not started | |
| 22 | Name the label printer model and label stock | The printer supplier | Printed stock labels (Phase 3) | Not started | |

## 4. Sign-off record

The decisions the group has confirmed, with the date of each. The development team adds a row when a decision is confirmed.

| Decision | Confirmed by | Date (DD-MM-YYYY) | Where it is recorded |
|---|---|---|---|
| The five decisions of Part A1 (one customer record for the group, the narrowest role in "All companies", who may run imports, English screens with Hinglish speech, the design direction) | The group | 27-09-2026 | [Workshop pack](workshop-pack.md#a1-taken-by-the-group-on-27-09-2026), Part A1 |
| The workshop answers | | | [Workshop pack](workshop-pack.md#part-c--answer-record), Part C |
| The design sign-off | | | [Design sign-off](design-signoff.md#5-decision), section 5 |
| The screen review | | | [Screen review](wireframe-review.md#8-record-of-sessions), section 8 |

The development team keeps its own checklist of these items in [exit-gate-actions.md](exit-gate-actions.md).
