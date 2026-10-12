# User acceptance: Lead Converter

The Lead Converter takes qualified leads to a quote and an order: calls, sizing, quotes and the signed copy, on one screen.

**Before you start:** sign in as a Lead Converter of one company, on the address the development team gives you (staging until production exists). Use the test customers and leads prepared for the test, never a real customer's details. Tick Pass when the result is what the third column says; tick Fail and write what you saw when it is not. A step that fails does not stop the test: carry on, and give the sheet to the run owner at the end.

| # | Step | Expected result | Pass / Fail |
|---|---|---|---|
| 1 | Open **Converting**. | Your open leads on a board by stage, and the list of next steps (callbacks due, quotes about to expire, sizing missing, orders held). | ☐ Pass ☐ Fail |
| 2 | Press J and K to move on the board and Enter to open a lead. | The lead opens on the right, with where it stands. | ☐ Pass ☐ Fail |
| 3 | Press L, choose an outcome and set a callback with C. | The call is saved and the callback set. | ☐ Pass ☐ Fail |
| 4 | Press S and record the lead's sizing (pump or rooftop). | The sizing is saved with its result, and "sizing missing" leaves the list. | ☐ Pass ☐ Fail |
| 5 | Press Q, build a quote from the sizing and save it. | A quote number is given; prices come from the customer's price tier and tax is worked out; no discount can be entered. | ☐ Pass ☐ Fail |
| 6 | Open the quote, open its document, then choose **Mark as sent**. | The document opens; the quote shows as sent. | ☐ Pass ☐ Fail |
| 7 | Choose **Record acceptance** and upload a signed copy prepared for the test. | After the check, the quote is accepted and its order is made. | ☐ Pass ☐ Fail |
| 8 | Open the order and choose **Confirm the order**. | The order is confirmed and the lead is marked won. | ☐ Pass ☐ Fail |
| 9 | Open **Quotes** and open an expired quote. | It says it has expired, and offers Re-quote at today's prices. | ☐ Pass ☐ Fail |
| 10 | Choose **Re-quote**. | A new quote is made at today's prices; the old one is kept as replaced. | ☐ Pass ☐ Fail |

**Tested by** (role and company): ______  **Date:** ______  **Steps passed:** ___ of 10

Notes:
