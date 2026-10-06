# Screen review with real users — Shakti Prime BOS

Prepared 27-09-2026 · last updated 07-10-2026. For: the development team running the sessions, and the owner who picks the reviewers.

The blueprint asks for clickable wireframes of the core screens for each role, reviewed with one or two real users of that role (BLUEPRINT §19 item 5, ROADMAP §2 week 4). The owner closed Phase 0 on 29-09-2026 with this review deferred. It is needed before the screens the prototype still shows are built: sales orders and dealer credit, the lead converter's screen and the home pages. The calling screen, quotes and the other screens already built are reviewed in the app. This script sets out who to invite, what each person is asked to do, what to watch for, and a form for the notes.

## 1a. Before the sessions
The development team prepares these on the review system (the staging site) and confirms each before the first session; building the demo data loader and publishing the prototype link are tracked in [STATUS, Open follow-ups](../10-status.md#open-follow-ups):
- **Demo data:** a small set, every record clearly labelled as demo data: items and kits with their prices on the Retail, Dealer and Commercial lists, and a few customers with leads in more than one company, a site, a note on the timeline and a consent. It includes the customer the tasks name (Bhanwar Lal Jat). The development team loads it on staging only, never on the live system, and removes it after the last session.
- **One account per role:** a sign-in for each of the eleven roles, given to the reviewer of that role at the session and closed after the reviews.
- **Authenticator apps:** the Executive, General Manager and Accounts reviewers must have an authenticator app on their phone before the session (the system asks for its code when they sign in); the development team helps them add the account at the start of their session.
- **The prototype link:** the clickable prototype is reached by a private link the development team sends to the session runners; it opens in any browser on desktop or phone, with no sign-in.

## 1. What people will use

Two things are reviewed together:

**Screens in the review system** (real sign-in, real saving, entries in the activity log). The development team shares the full address before the first session:
| Screen | Address | What it does | Roles that see it |
|---|---|---|---|
| Home | `/home` | The person's start page | All roles |
| Your profile | `/settings/profile` | The System, Light and Dark theme switch, the Higher contrast switch and the password change, from the profile menu | All roles |
| Leads | `/leads` | List with search and filters | Executive, General Manager, Sales Team Lead, tele-callers, Store Manager, Project Manager, Accounts |
| Leads board | `/leads/board` | Leads by stage: drag a card to another stage, or use the card's menu to move, assign, follow up later, reopen, win or lose | Executive, General Manager, Sales Team Lead, tele-callers, Store Manager, Project Manager, Accounts |
| New lead | `/leads/new` | The new lead form | Executive, General Manager, Sales Team Lead, tele-callers, Store Manager |
| Walk-in customer | `/leads/walk-in` | A quick form for a customer standing at the counter: the customer, the need and the company, saved in one go | Executive, General Manager, Sales Team Lead, tele-callers, Store Manager |
| Calling | `/calling` | The queue of leads to call, worked by keyboard: the number keys record how the call went, N moves to the next lead; callbacks, retries and follow-up calls are set from the outcome; a team lead sees the team's queues | Executive, General Manager, Sales Team Lead, tele-callers, Store Manager |
| Quotes | `/quotes` | The list of quotes, the quote builder with prices from the customer's price list and GST worked out by the system, the quote page to send, withdraw or quote again, and the printed quote | Executive, General Manager, Sales Team Lead, tele-callers, Store Manager, Project Manager, Accounts see the list; the first five make quotes |
| Duplicates | `/duplicates` | Leads and customers the system thinks are the same person, to merge, keep apart or undo a merge | Executive, General Manager, Sales Team Lead |
| Agent Inbox | `/inbox` | Suggestions from the AI assistants, to approve or decline; the icon in the top bar shows how many are waiting | Executive, General Manager, Sales Team Lead, tele-callers, Store Manager, Inventory Manager, Project Manager, Accounts |
| Team members | `/admin/users` | List, invite, change role, reset a lost authenticator app | Executive |
| Activity log | `/admin/activity` | Who changed what and when | Executive, General Manager, Accounts |
| Customers | `/customers` | Customers list with search and saved views; phone numbers shown by their last four digits | Every role but HR Admin |
| Customer page | `/customers/<customer>` | Contacts, sites, leads, the timeline, tasks, tags and consent with its proof, on one page | Every role but HR Admin |
| Companies | `/settings/companies` | Each company's name, with its brand name, GSTIN, state, registered address and UPI ID to edit, and its logo and letterhead to upload; its bank account, and the letterhead used on printed documents | Executive |
| Price lists | `/price-master` | The prices on each price list, with the date the list starts and when each price last changed; a new price applies from now on | Executive edits; every role but Field Engineer and HR Admin can view |
| Catalogue | `/catalogue`, `/catalogue/kits` | Items with their specifications and pump curves, and kits with their parts | Every role but Field Engineer and HR Admin can view; a change needs an Executive, General Manager or Inventory Manager working in "All companies" |
| Tax rates | `/settings/tax` | GST rates per HSN code and the solar composite-supply rules, each from a date | Executive and Accounts; a change needs "All companies" |
| Roles | `/admin/roles` | What each role may do, by module, with a confirmation that names how many people are signed out | Executive |
| Integration health | `/admin/integrations` | Messages waiting or held back between parts of the system, with Send again and a delivery check | Executive |
| Pipelines | `/settings/pipelines` | The stages of each sales pipeline, the call outcomes and how a lead's priority is worked out | Executive |
| Agents | `/admin/agents` | Each AI assistant, with a button to stop it and its daily spending limit | Executive, General Manager |
| Imports | `/imports` | Upload a spreadsheet of leads, customers or the PIN code list, match its columns, check the rows, then add them (items come later) | Executive, General Manager |
| Design preview | `/design` | Every colour, text size and component in the light and dark themes (reviewed in `design-signoff.md`) | All roles |

**The clickable prototype** (the private link of §1a, opened in any browser on desktop or phone, with no sign-in). It shows the Phase 1 screens that are not built yet; the screens built since are marked as built in it and are reviewed in the app. Nothing in it is saved; every person, village and amount in it is invented. The first screen says it is a prototype and asks the reviewer to pick a role:
| Prototype screen | Roles |
|---|---|
| Role home pages | All eleven roles |
| Cold-calling script panel (the calling screen itself is in the app) | Tele-caller (cold calling), Sales Team Lead |
| Turning an accepted quote into a sales order (the quotes themselves are in the app) | Tele-caller (converter), Store Manager, Executive, Accounts |
| Sales orders: list and detail | Tele-caller (converter), General Manager, Inventory Manager, Accounts, Executive |
| Dealer credit | Accounts, Executive, General Manager |
| The Store Manager home, with the day's walk-ins (the walk-in form itself is in the app) | Store Manager |
| Field engineer's day (phone width) | Field Engineer |

## 2. Who to invite

One or two people for each of the eleven roles; two where the role has many people (tele-callers, store staff, field engineers). Pick people who do the job today, not their managers speaking for them. A person with two jobs reviews both.

| Role | Their job in the system (PRD §2) | Reviewers | Names |
|---|---|---|---|
| Executive | Direction, approvals, price lists, AI assistant settings, profit and margins | 1 | |
| General Manager | Operations, response times, escalations; no cost figures | 1 | |
| Sales Team Lead | Supervising callers, reassigning leads, targets | 1–2 | |
| Tele-caller, cold calling | The calling queue and qualifying leads | 2 | |
| Tele-caller, lead converter | WhatsApp conversations, sizing, quotes and orders | 2 | |
| Store Manager | Walk-in customers and their own records | 1–2 | |
| Inventory Manager | Stock, purchasing, suppliers, dispatch, returns | 1 | |
| Project Manager | Projects, subsidy steps, scheduling, quality checks | 1 | |
| Field Engineer | Surveys, installations, checks, attendance and expenses on the phone | 2 | |
| Accounts | Proformas, payments, matching with Tally, job costs, tax rates, expenses | 1–2 | |
| HR Admin | Employees, attendance, leave, incentives | 1 | |

## 3. Running a session

- **Length:** 30 to 40 minutes per person, one person at a time.
- **Device:** the device they use at work. Field engineers and store staff on their Android phone; office roles on a desktop or laptop. Every reviewer also tries one task on the other device if time allows.
- **People in the room:** the reviewer, one person from the development team who runs the session, and one who takes notes. The reviewer's manager should not be in the room.
- **Consent:** ask before taking photos or recording the screen. Record only the screen, never the person's face, and delete the recording after the notes are written.
- **Data:** the prototype holds only invented data, and the review system only the labelled demo data of §1a. No real customer record is used or shown.

**Opening words (read out):**
"Thank you for your time. We are building a new system for your daily work and want to see how easy it is to use before we finish it. We are testing the screens, not you; there are no wrong answers. Please say out loud what you are thinking as you go, including anything that confuses you or any word you would say differently. Some screens are only a picture of the real thing; nothing you do here is saved or seen by customers. I will not help you during a task, but I will answer every question at the end."

**For each task:** read the task out, let the person work, and stop them after five minutes if they are stuck. Do not point, hint or explain. After each task ask: "How easy was that, from 1 (very hard) to 5 (very easy)?" and "Was there any word you did not understand?"

**Closing questions:**
1. What would slow you down if you did this 100 times a day?
2. What is missing that you use today in sheets, the old CRM or on paper?
3. Which screen would you want first?
4. Light or dark: which would you use, and where?

## 4. Tasks per role

"App" means the review system; "Prototype" means the clickable prototype. Each task has what counts as done.

### 4.1 Executive
| Task | What to do | Where | Done when |
|---|---|---|---|
| Task E1 | "From your home page, tell me which company brought in the most sales order value this month, and how many leads are waiting for a first call." | Prototype, Executive home | Both figures read out correctly |
| Task E2 | "Set a new retail price for the 5 HP solar pump kit, to apply from now on, and say why." | App, Price lists | Price saved on the Retail list with a reason |
| Task E3 | "Find who changed a price in the last seven days." | App, Activity log | The right entry is opened |
| Task E4 | "A dealer's order is on hold for credit. Release it and say why." | Prototype, Dealer credit | Release given with a reason |
| Task E5 | "Add a new tele-caller to Agro Solar Hub." | App, Team members | Invitation sent with the right role and company |

### 4.2 General Manager
| Task | What to do | Where | Done when |
|---|---|---|---|
| Task G1 | "From your home page, find the leads whose callback is overdue, and who owns them." | Prototype, GM home | The overdue list and the owner are named |
| Task G2 | "Look only at Shakti Motor Pumps, then go back to all companies." | Prototype, company switcher in the top bar | Both switches done |
| Task G3 | "Open the customer Bhanwar Lal Jat and tell me which companies he has enquired with, and about what." | App, Customers and the customer's page | Both companies' leads named |
| Task G4 | "Find the sales orders waiting to be confirmed." | Prototype, Sales orders | The filter or status is used |

### 4.3 Sales Team Lead
| Task | What to do | Where | Done when |
|---|---|---|---|
| Task T1 | "Which caller in your team has made the most calls today, and who is behind target?" | Prototype, Team lead home | Both named |
| Task T2 | "A converter is on leave today. Move one of their leads to another converter." | App, Leads board | Lead reassigned from the card |
| Task T3 | "Find the leads in Contacted that have been open for more than three days." | App, Leads board | The "Open for" days on the cards in the Contacted column are used |
| Task T4 | "A customer from Chomu called back, but you only remember that his name sounds like Ramesh. Find his lead." | App, Search or go to (Ctrl K) | The lead is found by a half-remembered name or the village |

### 4.4 Tele-caller, cold calling
| Task | What to do | Where | Done when |
|---|---|---|---|
| Task C1 | "Start calling. The customer asks you to call back tomorrow. Record that and move to the next lead, without using the mouse." | App, Calling | Outcome recorded with a number key, next lead with N |
| Task C2 | "This customer wants a 5 HP solar pump and has a borewell of 180 feet. Mark the lead as qualified." | App, Calling | Qualified pressed; the reviewer notices who the lead goes to |
| Task C3 | "Read the opening line of the script out loud." | Prototype, script panel | Read without stumbling; note words they change |
| Task C4 | "A farmer calls you directly. Add him as a new lead." | App, New lead | Lead saved with village and phone |
| Task C5 | "Find the lead with the phone number ending 4471." | App, Search or go to (Ctrl K) | Lead found by search |

### 4.5 Tele-caller, lead converter
| Task | What to do | Where | Done when |
|---|---|---|---|
| Task L1 | "Move a lead from Qualified to Quoted." | App, Leads board | Card moved |
| Task L2 | "Make a quote for a 7.5 HP solar pump kit for a farmer, and tell me the total with GST." | App, Quotes | Line added and total read out |
| Task L3 | "Open the customer Bhanwar Lal Jat and tell me what the last note on his timeline says." | App, the customer's page | The note found in the timeline |
| Task L4 | "The customer accepted the quote. Turn it into a sales order." | Prototype, quote builder and Sales orders | Sales order opened |

### 4.6 Store Manager
| Task | What to do | Where | Done when |
|---|---|---|---|
| Task S1 | "A farmer walks in asking about a solar pump. Record him while he is standing at the counter." | App, Walk-in customer | Saved in under 30 seconds |
| Task S2 | "Show me the walk-ins you recorded today." | Prototype, Store home | List found |
| Task S3 | "The farmer asks the price of the 3 HP kit. Find it." | App, Price lists | Price read out for the Retail tier |

### 4.7 Inventory Manager
| Task | What to do | Where | Done when |
|---|---|---|---|
| Task I1 | "Which items are low or out of stock?" | Prototype, Inventory home | Items named |
| Task I2 | "Which sales orders are waiting for stock before they can be dispatched?" | Prototype, Inventory home | Orders named |
| Task I3 | "Open one of those sales orders and tell me what is still to be dispatched." | Prototype, sales order detail | Remaining quantities read |
| Task I4 | "Find the current dealer price of a 5 HP pump controller." | App, Price lists | Price read out |

### 4.8 Project Manager
| Task | What to do | Where | Done when |
|---|---|---|---|
| Task P1 | "Which rooftop projects are stuck waiting for a customer document?" | Prototype, Project Manager home | Projects and missing documents named |
| Task P2 | "Which engineer visits are booked for tomorrow?" | Prototype, Project Manager home | Visits named |
| Task P3 | "Open the customer Bhanwar Lal Jat and find the details of his site." | App, Customers and the customer's page | Site found |

### 4.9 Field Engineer (on the phone)
| Task | What to do | Where | Done when |
|---|---|---|---|
| Task F1 | "Open your jobs for today. Where is your first visit and how do you call the customer?" | Prototype, Field Engineer home at phone width | Village and call button found |
| Task F2 | "You have reached the site. Show me how you would mark that." | Prototype, Field Engineer home | "Reached site" pressed |
| Task F3 | "Read the grey note at the top of the screen. What does it mean for you?" | Prototype, the offline note | The person explains it in their own words |

### 4.10 Accounts
| Task | What to do | Where | Done when |
|---|---|---|---|
| Task A1 | "Which dealers are over their credit limit or overdue?" | Prototype, Accounts home and Dealer credit | Dealers named |
| Task A2 | "On this sales order, what are the CGST and SGST amounts?" | Prototype, sales order detail | Both read out |
| Task A3 | "One dealer order is on hold. Explain to me why, in your own words." | Prototype, Dealer credit | The reason on the order is explained |
| Task A4 | "Show me everything that changed yesterday in Shakti Supreme." | App, Activity log | Filter by company and date |

### 4.11 HR Admin
| Task | What to do | Where | Done when |
|---|---|---|---|
| Task H1 | "Who is on leave today, and who has not marked attendance?" | Prototype, HR home | Both lists found |
| Task H2 | "Find Deepak Saini and tell me his role and company." | Prototype, HR home | Found in the staff list |
| Task H3 | "What would you expect to do on this home page every morning?" | Prototype, HR home | Answer noted (the HR screens come in Phase 5) |

## 5. What to watch for
- **Time and path:** how long each task takes and every wrong turn before the right one.
- **Words:** any word the person stops on, asks about, or replaces with their own. Write their word down exactly; the product vocabulary may change to match it.
- **Numbers and dates:** whether ₹ amounts with lakh grouping, DD-MM-YYYY dates and kW and HP figures read naturally.
- **Density:** whether queues and tables show enough on one screen, or too much.
- **Keyboard (callers):** whether callers use number keys and N without being told once they see the key hints.
- **Phone:** thumb reach, text size in daylight, whether the menu panel is found.
- **Trust:** anything that makes the person doubt a figure (for example "is this price with GST?").
- **Missing:** anything they reach for that is not there.

## 6. Notes form
Copy one per reviewer.

```
Reviewer (first name only): ____________________   Role: ____________________
Company: ______________________   Device: desktop / laptop / phone (model: ______)
Date (DD-MM-YYYY): ____________   Session run by: ____________   Notes by: ____________

Task | Done (yes / with help / no) | Time | Ease 1-5 | Wrong turns | Words not understood (and their word)
-----+-----------------------------+------+----------+-------------+-----------------------------------
     |                             |      |          |             |
     |                             |      |          |             |
     |                             |      |          |             |
     |                             |      |          |             |
     |                             |      |          |             |

What would slow you down 100 times a day:


What is missing that you use today:


Which screen first:


Light or dark, and where:


Other observations:


Changes the development team proposes (filled after the session):
1.
2.
3.
```

## 7. After the sessions
1. Within two working days, the development team lists every change found, grouped by screen, with how many reviewers hit it.
2. Changes to words go into the product's word list and the writing rules (`docs/08-design-system.md` §11) where they apply to every screen.
3. The owner reviews the list and marks each change "before that screen is built", "later in Phase 1" or "not needed".
4. The prototype is updated for the "before that screen is built" changes and shown again to one reviewer per affected role.

## 8. Record of sessions
| Role | Reviewer 1 (date) | Reviewer 2 (date) | Changes found | Owner's review done |
|---|---|---|---|---|
| Executive | | | | |
| General Manager | | | | |
| Sales Team Lead | | | | |
| Tele-caller, cold calling | | | | |
| Tele-caller, lead converter | | | | |
| Store Manager | | | | |
| Inventory Manager | | | | |
| Project Manager | | | | |
| Field Engineer | | | | |
| Accounts | | | | |
| HR Admin | | | | |
