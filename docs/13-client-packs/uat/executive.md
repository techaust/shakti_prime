# User acceptance: Executive

The Executive sees every company and sets the group up: people and roles, prices, tax rates, pipelines, agents, and the decisions only an Executive takes, such as releasing an order held for credit.

**Before you start:** sign in as a person with the Executive role in one company, on the address the development team gives you (staging until production exists). Use the test customers and leads prepared for the test, never a real customer's details. Tick Pass when the result is what the third column says; tick Fail and write what you saw when it is not. A step that fails does not stop the test: carry on, and give the sheet to the run owner at the end.

| # | Step | Expected result | Pass / Fail |
|---|---|---|---|
| 1 | Open **Home**. | Quotes waiting and accepted, orders confirmed this month with their value per company and for the group, and the pipeline by stage. | ☐ Pass ☐ Fail |
| 2 | Open **Team members** and invite a person as a Cold Caller of one company. | The person is listed as invited, and they get an email to set their password. | ☐ Pass ☐ Fail |
| 3 | Open **Roles** and open the Cold Caller role. | Its permissions are listed with their reach; a permission only the system may hold is shown locked with its reason. | ☐ Pass ☐ Fail |
| 4 | Open **Price lists** and open the current list of one company. | Each item has one price per price tier; no discount field exists anywhere. | ☐ Pass ☐ Fail |
| 5 | Open **Tax rates**. | Each item's GST rate with the date it applies from. | ☐ Pass ☐ Fail |
| 6 | Open **Pipelines**, choose one pipeline and look at its stages and call outcomes. | The stages in order with their rules, and the call outcomes with their next step. | ☐ Pass ☐ Fail |
| 7 | Open **Orders** and open an order held for credit. | The order says why it is held (over the limit, an unpaid invoice past the credit days, or no limit set). | ☐ Pass ☐ Fail |
| 8 | Choose **Release the hold**, give a reason and release it. | The order shows "Credit hold released" with your name and reason, and can now be confirmed once. | ☐ Pass ☐ Fail |
| 9 | Open **Activity log** for today. | The release is listed with your name, the order and the time. | ☐ Pass ☐ Fail |
| 10 | Open **Integration health**. | The waiting and failed messages per kind, and AI spend per agent for today and this month. | ☐ Pass ☐ Fail |
| 11 | Open **Agents** and then **Triage proposals**. | Each agent's autonomy and limits; the Triage agent's proposals beside what people did. | ☐ Pass ☐ Fail |
| 12 | Press Ctrl K (⌘K on a Mac), type part of a customer's mobile number and open the result. | The customer opens on their page, with leads, sites, timeline and consents. | ☐ Pass ☐ Fail |

**Tested by** (role and company): ______  **Date:** ______  **Steps passed:** ___ of 12

Notes:
