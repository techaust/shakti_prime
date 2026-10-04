# Design sign-off — Shakti Prime BOS

Prepared 27-09-2026 · last updated 04-10-2026. For: an Executive of the Shakti group, with one tele-caller and one field or store person at the review.

This sign-off was an item of the Phase 0 exit gate (ROADMAP §2). The owner closed Phase 0 on 29-09-2026 with it deferred: it is needed before the calling screen (T1) and quotes (S1) are built, so that any change lands while few screens exist, and a change agreed later is applied to every built screen before the Phase 1 user acceptance tests (M1).

The design system is written down in the design guide and shown live on the system's Design preview page, which displays every colour, text size and component in the light and dark themes side by side. This checklist walks through what to look at and records the decision.

**What sign-off means:** the look, the colours, the text sizes, the spacing and the writing rules are agreed, and every screen built from now on follows them. Screens themselves are reviewed separately with real users (`wireframe-review.md`); this sign-off is about the building blocks.

## 1. Before the review
- [ ] The development team has sent the web address of the review system and a sign-in for the reviewer.
- [ ] The Executive reviewer has an authenticator app on their phone (the system asks for its code when an Executive signs in); the development team helps add the account before the review starts.
- [ ] The development team has sent the private link to the clickable prototype, which holds the sample caller script (check 42).
- [ ] The reviewer has a desktop or laptop (a screen at least 1280 pixels wide) and an Android phone that staff actually use.
- [ ] The phone's display and text size are left at the settings staff normally use.
- [ ] Allow 45 minutes. Do the review in daylight in an office, and repeat the phone checks outdoors for five minutes.

## 2. How to open the pages
1. Sign in, then open **Design preview** from the menu.
2. The theme switch on the **Your profile** page (from the profile menu) offers **System**, **Light** and **Dark**. System follows the device; Light and Dark fix the choice for this person on every device they use. Below it, **Higher contrast** turns on the high-contrast variant for phones used in sunlight, also kept on the person's profile.
3. Do every check below in **Light**, then again in **Dark**. On the phone, also check **System** with the phone's own dark mode turned on and off: the screen should change without a reload and without a white flash.

## 3. Checklist

Tick each line in both themes. Write any concern in the notes column; a concern does not stop sign-off unless marked "must change".

### 3.1 Overall impression
| # | Check | Light | Dark | Notes |
|---|---|---|---|---|
| 1 | The screens feel calm and professional, suited to a business used all day | | | |
| 2 | Light and dark both look finished; neither looks like an afterthought | | | |
| 3 | There is one accent colour (indigo) for buttons, links and selection, and nothing else competes with it | | | |
| 4 | The group is comfortable with indigo as the product colour; company logos appear on customer documents, not in the app's colours | | | |

### 3.2 Colours and status
| # | Check | Light | Dark | Notes |
|---|---|---|---|---|
| 5 | Body text is easy to read on every background shown (the page shows a contrast figure for each; all body text must be 4.5 or higher) | | | |
| 6 | Secondary grey text (labels, dates) is still readable on the phone outdoors | | | |
| 7 | The four status colours are clearly different: green (done, healthy), amber (needs attention), red (problem, overdue), blue (information) | | | |
| 8 | Pipeline stage colours are easy to tell apart: New (grey), Contacted (amber), Qualified (indigo), Quoted (blue), Won (green), Lost (red) | | | |
| 9 | Stock colours make sense: healthy (green), low (amber), out of stock (red), reserved (blue) | | | |
| 10 | Status is never shown by colour alone: every badge also has a word | | | |
| 11 | The four small company dots can be told apart, and are used only as small markers | | | |
| 11a | With **Higher contrast** turned on (Your profile), text, borders and the focus outline are stronger, and the pages still look finished | | | |

### 3.3 Text
| # | Check | Light | Dark | Notes |
|---|---|---|---|---|
| 12 | The typeface (Inter) reads well at every size shown | | | |
| 13 | Body text (14 on desktop, 15 on the phone) is comfortable for a full day's work | | | |
| 14 | Dense text in tables and queues (13) is still readable for callers | | | |
| 15 | Nothing is smaller than 12 | | | |
| 16 | Numbers in tables line up in columns, and amounts are right-aligned | | | |
| 17 | When the phone's own text size is made larger, the pages grow with it and nothing is cut off | | | |

### 3.4 Density and spacing
| # | Check | Light | Dark | Notes |
|---|---|---|---|---|
| 18 | Queues and tables fit enough rows to work without constant scrolling (compact rows 32 high, normal rows 40) | | | |
| 19 | Home pages and forms have more breathing room than queues and tables | | | |
| 20 | Buttons and fields on the phone are easy to tap with a thumb (44 high), including with gloves or dusty hands in the field | | | |
| 21 | The keyboard focus ring (a clear indigo outline) is visible on every button and field when moving with the Tab key | | | |

### 3.5 Components
| # | Check | Light | Dark | Notes |
|---|---|---|---|---|
| 22 | Buttons: the main button (indigo), the secondary button (outlined), the quiet button and the red button for risky actions are easy to tell apart | | | |
| 23 | Fields: the label sits above the field, help or error text below; errors are red with an icon and a plain sentence | | | |
| 24 | Dates are shown and picked as DD-MM-YYYY; times are 24-hour | | | |
| 25 | Money is shown with ₹ and Indian grouping, for example ₹1,24,500.00 | | | |
| 26 | Status badges are small, readable and consistent | | | |
| 27 | Empty states say one plain sentence and offer one action | | | |
| 28 | Loading shows grey outlines of the content, not a spinning wheel | | | |
| 29 | Messages that confirm an action appear bottom-right on desktop and at the top on the phone, and disappear after a few seconds | | | |

### 3.6 Phone and desktop
| # | Check | Phone | Desktop | Notes |
|---|---|---|---|---|
| 30 | There is no sideways scrolling of the page anywhere | | | |
| 31 | On the phone, the menu opens as a panel from the side and closes cleanly | | | |
| 32 | On the phone, tables turn into readable cards | | | |
| 33 | The phone pages are usable in bright sunlight | | | |
| 34 | On desktop, the side menu (240 wide) can shrink to icons to give more room | | | |

### 3.7 Words on screen
The writing rules are in the design guide (its section 11). Check the words on the Design preview page and on these screens, each opened from the menu: the sign-in and forgotten-password pages, Home, Leads (the list, the board and New lead), Your profile, Team members, Activity log, Companies, Price lists, Catalogue (items and kits), Customers (the list and a customer's page), Imports, Tax rates, Roles and Integration health.

| # | Check | Yes | Notes |
|---|---|---|---|
| 35 | Every word is plain English a new tele-caller understands on day one | | |
| 36 | No technical words, codes or vendor names appear anywhere | | |
| 37 | Error messages say what happened and what to do next, without blame | | |
| 38 | There are no exclamation marks, and no sample or unfinished text | | |
| 39 | One name is used for each thing: Lead, Customer, Site, Quote, Sales Order, Dispatch, Project, Proforma, Payment, Engineer visit, Price list, Stock, Kit, Serial number, Warranty claim. The group agrees with these names | | |
| 40 | Customers are addressed with "ji" (for example "Ramesh ji"); staff by first name | | |
| 41 | Hinglish appears only in caller scripts and the voice assistant, written in Roman letters, with the agreed spellings (aap, ji, haan, nahin, theek hai, dhanyavaad) | | |
| 42 | A tele-caller has read the sample caller script aloud (in the prototype's cold-calling screen) and it sounds natural | | |

### 3.8 Printed documents
| # | Check | Yes | Notes |
|---|---|---|---|
| 43 | The group agrees that quotes, proformas, challans and labels are always printed in the light style with the selling company's letterhead, whatever theme the user has chosen | | |

## 4. Changes requested
List anything that must change before sign-off. The development team makes the change, updates the design guide and the Design preview page, and returns for a short second look at those items only.

| # | Item (check number or area) | Change requested | Must change before sign-off, or later | Done |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |

## 5. Decision
Tick one:
- [ ] **Signed off.** The design system in the design guide and the Design preview page is approved as it stands.
- [ ] **Signed off with the changes in section 4**, which the development team makes without a further review.
- [ ] **Not yet signed off.** A second review follows once the changes marked "must change" are made.

| | Name | Role | Signature | Date (DD-MM-YYYY) |
|---|---|---|---|---|
| For the Shakti group | | Executive | | |
| Also present | | Tele-caller | | |
| Also present | | Field or store staff | | |
| For the development team | | | | |
| Version reviewed | The design guide and the Design preview page as of the review date; the development team writes here the version of the system reviewed | | | |
