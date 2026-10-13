# Parallel run

The two weeks after the [cutover](../runbooks/cutover.md) (PRD IMP-02), when the group works in the BOS and keeps its old records beside it, read-only, as the reference. Each day a few things are compared; each difference is written down and settled; at the end the group decides whether the old records can be put away. Written for the group's people: no step needs anything but the BOS screens and the old records.

**Who:** a **run owner** (an Executive), one **checker per company** (its General Manager or someone they name), **Accounts**, and the **sales head**. The development team's **developer on call** answers the log every day. People are named in the [client actions](client-actions.md) record, never here.

## 1. What is compared each day

Each checker, for their company, at the end of the day:

| What | In the BOS | In the old records | Same when |
|---|---|---|---|
| New leads today | Leads, newest first | The day's sheet or register | Every enquiry is in the BOS once, with the right customer and owner |
| Calls made | Home (calls today) and Calling | The callers' own count | The counts agree within 2 |
| Leads moved on | Leads, by stage | The sales head's list | Every lead the team qualified or lost today shows its new stage |
| Quotes made | Quotes, newest first | Quotes written outside the BOS (there should be none) | Every quote given to a customer is in the BOS |
| Orders confirmed | Orders, newest first | Orders taken by phone or at the counter | Every order is in the BOS, with the right customer and value |
| Dealer credit | Dealer credit | Accounts' ledger | Each dealer's outstanding and limit agree after Accounts' entries |
| Customers changed | Customers (a sample of 5 opened today) | The customer's file | Name, mobile, village and company agree |

Accounts also compares, on each Monday and on the last day, the total outstanding per company on Dealer credit with the ledger's total.

## 2. How a difference is logged

The run owner keeps one log (a shared sheet) with a row per difference:

| Column | What goes in it |
|---|---|
| Number | 1, 2, 3 … |
| Date and company | |
| Found by | The checker's role |
| Screen | The BOS screen where it shows |
| What differs | In plain words: "Lead for the Patil farm shows owner Caller A; the register says Caller B" |
| Which is right | The BOS, the old records, or not yet known |
| Cause | Wrong entry today, wrong import, a rule of the BOS, a mistake in the old records |
| Settled by and when | |

## 3. How a difference is settled

- **A wrong entry today:** the person who made it corrects it in the BOS the same day; the old records are not changed.
- **A wrong import:** the developer on call and the checker correct the record in the BOS through its screen (customer, lead, owner, stage); a pattern of wrong imports (more than five of one kind) goes to the cutover lead, who checks the file and the import's "What happened to each row".
- **A rule of the BOS** (a calculation, a credit hold, a stage rule): the developer on call explains it in the log within one working day; when the rule is wrong it is fixed and the fix named in the log; when the old way was wrong the run owner records the decision.
- **A mistake in the old records:** written down and left; the BOS is the record from the cutover on.

No difference is settled by entering anything in the old records.

## 4. The exit rule

The parallel run ends after ten working days when the run owner confirms all of these:
1. The last five working days had no open difference older than one working day.
2. No difference in the last five working days was caused by the BOS (a wrong rule or a fault).
3. Accounts' dealer outstanding totals agreed on the last day.
4. Each company's checker signs that their team works in the BOS alone.

When a condition is not met, the run goes on for five more working days and the rule is read again. When the run ends, the old records are put away as the group's archive and the log is filed with the [client actions](client-actions.md) record.
