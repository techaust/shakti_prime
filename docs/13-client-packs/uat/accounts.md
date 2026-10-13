# User acceptance: Accounts

Accounts keeps dealer credit: each dealer's limit, credit days and what they owe, which decide whether a dealer's order is held.

**Before you start:** sign in as a person with the Accounts role in one company, on the address the development team gives you (staging until production exists). Use the test customers and leads prepared for the test, never a real customer's details. Tick Pass when the result is what the third column says; tick Fail and write what you saw when it is not. A step that fails does not stop the test: carry on, and give the sheet to the run owner at the end.

| # | Step | Expected result | Pass / Fail |
|---|---|---|---|
| 1 | Open **Home**. | The orders held for credit, the dealers over their limit and those with an overdue invoice. | ☐ Pass ☐ Fail |
| 2 | Open **Dealer credit** and choose a company. | The company's dealers with credit limit, credit days, outstanding, oldest unpaid invoice, orders confirmed since and total owed. | ☐ Pass ☐ Fail |
| 3 | For one dealer, choose **Enter limit and days**, enter a limit and credit days and save. | The dealer's row shows the new limit and days; the earlier entry is kept in Earlier entries. | ☐ Pass ☐ Fail |
| 4 | Choose **Enter outstanding**, enter the amount owed, the date it is as of and the oldest unpaid invoice, and save. | The row shows the outstanding and the oldest unpaid invoice with its age. | ☐ Pass ☐ Fail |
| 5 | Open **Earlier entries** for that dealer. | Every earlier limit and outstanding entry with who entered it and when. | ☐ Pass ☐ Fail |
| 6 | Ask a seller to make a dealer order above the dealer's limit, then open **Orders** and that order. | The order is held, and says the dealer would owe more than their limit. | ☐ Pass ☐ Fail |
| 7 | Open the held order and look for a way to release it. | There is none for Accounts: only an Executive may release a hold. | ☐ Pass ☐ Fail |
| 8 | Open **Activity log** for today. | Your entries are listed with your name and time. | ☐ Pass ☐ Fail |

**Tested by** (role and company): ______  **Date:** ______  **Steps passed:** ___ of 8

Notes:
