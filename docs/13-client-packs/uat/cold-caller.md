# User acceptance: Cold Caller

The Cold Caller works a queue of leads by phone: calls, outcomes, callbacks, and passing qualified leads on.

**Before you start:** sign in as a Cold Caller of one company, on the address the development team gives you (staging until production exists). Use the test customers and leads prepared for the test, never a real customer's details. Tick Pass when the result is what the third column says; tick Fail and write what you saw when it is not. A step that fails does not stop the test: carry on, and give the sheet to the run owner at the end.

| # | Step | Expected result | Pass / Fail |
|---|---|---|---|
| 1 | Open **Home**. | Your queue (calls due, first calls late, leads waiting, calls today) and your targets for today, this week and this month. | ☐ Pass ☐ Fail |
| 2 | Open **Calling**. | Your queue, the lead to call next at the top, with the number to dial. | ☐ Pass ☐ Fail |
| 3 | Open the first lead, call the number from your phone, then log the outcome **Call back later** with a time tomorrow. | The call is saved, the lead leaves today's queue, and a callback appears for tomorrow. | ☐ Pass ☐ Fail |
| 4 | Open the next lead and log the outcome **Not reachable**. | The call is saved and the lead comes back for its next attempt as the calling rules say. | ☐ Pass ☐ Fail |
| 5 | Open a lead and log the outcome **Qualified**. | The lead moves to Qualified and, when a Lead Converter is present, is passed to them; it leaves your queue. | ☐ Pass ☐ Fail |
| 6 | Open **New lead**, enter a customer's name, mobile, village and PIN, choose the pipeline and save. | The PIN fills the tehsil and district; the lead is saved and owned by you. | ☐ Pass ☐ Fail |
| 7 | Enter the same mobile number again on New lead. | You are told the customer already exists, and the new enquiry is added to them instead of a second customer. | ☐ Pass ☐ Fail |
| 8 | Open **Leads**. | Only your own leads. | ☐ Pass ☐ Fail |
| 9 | Look for **Converting** in the menu. | There is none: a Cold Caller makes no quotes; qualified leads go to a Lead Converter. | ☐ Pass ☐ Fail |
| 10 | Press Ctrl K (⌘K on a Mac) and type part of one of your leads' mobile numbers. | Your lead is found; leads that are not yours are not. | ☐ Pass ☐ Fail |

**Tested by** (role and company): ______  **Date:** ______  **Steps passed:** ___ of 10

Notes:
