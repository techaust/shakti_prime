# User acceptance: General Manager

The General Manager runs one company: its leads and teams, first calls running late, duplicates, imports and the converters who take qualified leads.

**Before you start:** sign in as a person with the General Manager role in one company, on the address the development team gives you (staging until production exists). Use the test customers and leads prepared for the test, never a real customer's details. Tick Pass when the result is what the third column says; tick Fail and write what you saw when it is not. A step that fails does not stop the test: carry on, and give the sheet to the run owner at the end.

| # | Step | Expected result | Pass / Fail |
|---|---|---|---|
| 1 | Open **Home**. | First calls still waiting past their pipeline's limit, those made late in the last 30 days, and open leads by stage for your company. | ☐ Pass ☐ Fail |
| 2 | Open **Leads** and switch to the board. | Your company's leads in columns by stage; no lead of another company appears. | ☐ Pass ☐ Fail |
| 3 | Open one lead and assign it to a caller of your company. | The lead shows its new owner, and the timeline records the change. | ☐ Pass ☐ Fail |
| 4 | Open **Duplicates**. | Pairs of customers or leads that may be one, each with why it was suggested. | ☐ Pass ☐ Fail |
| 5 | Open one pair and choose that they are not the same. | The pair leaves the list. | ☐ Pass ☐ Fail |
| 6 | Open **Imports** and upload a small customers file prepared for the test. | The columns are offered for matching to the BOS's fields. | ☐ Pass ☐ Fail |
| 7 | Match the columns, choose **Check the rows**. | Each row is ready, needs correcting with a reason, or is repeated in the file. | ☐ Pass ☐ Fail |
| 8 | Add the rows and wait until the import is finished. | The import shows the customers added, and the section "What happened to each row". | ☐ Pass ☐ Fail |
| 9 | In "What happened to each row", compare **Rows in the file** with the rows in your file, then choose **Download as CSV**. | The two counts are equal, the lines below add up to it, and the downloaded file shows the same lines. | ☐ Pass ☐ Fail |
| 10 | Open **Lead converters** and set one person's presence to away. | The person no longer receives new qualified leads until set present again. | ☐ Pass ☐ Fail |
| 11 | Open **Targets** and set a daily call target for a team. | The target is listed among the targets in force. | ☐ Pass ☐ Fail |

**Tested by** (role and company): ______  **Date:** ______  **Steps passed:** ___ of 11

Notes:
