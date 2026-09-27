# DESIGN.md — Shakti Prime design system

Blueprint reference: §11. Foundation: Linear's default app design (precision, density, restraint, one indigo accent), with light and dark themes generated the way Linear generates its own, for a business system used on desktops, phones and in the field.

## 1. Principles
1. **Calm surface, dense where work happens.** Generous spacing on home pages and forms; tight, scannable rows in queues, grids and boards.
2. **One accent.** Indigo `#5E6AD2`, Linear's default accent, is the only accent colour. Everything else is neutral or a semantic status colour.
3. **Light and dark are equals.** Both themes are generated from the same three inputs (§2.1); nothing is designed in one and translated to the other.
4. **One language on screen.** Everything a person reads is plain English. Hinglish in Roman script is used only where staff or the voice agent speak to customers (§11.5).
5. **Touchable in the field.** Minimum 44 px targets and higher contrast on phone layouts.
6. **Printed outputs are always light** and carry the selling entity's letterhead.

## 2. Colour tokens
All colours are semantic CSS variables on `:root`. Components never use raw hex values.

### 2.1 Theme generation
As in Linear, each theme is generated from three inputs in the LCH colour space. LCH is perceptually uniform: two colours with the same lightness look equally light whatever their hue, so every generated step reads consistently in both themes.

| Input | Light | Dark | Effect |
|---|---|---|---|
| Base | `#FFFFFF` | `#08090A` | The page background. The neutral ladder (surfaces, borders, text) steps away from it in lightness, carrying a trace of the accent's hue. |
| Accent | `#5E6AD2` | `#5E6AD2` | Fills, focus and selection. Hover, text and soft tints are derived from it. |
| Contrast | 30 | 30 | The spread of the ladder, from 0 to 100. Higher values darken text and borders in light and lighten them in dark. The high-contrast variant for field phones uses a higher value. |

`packages/tokens` runs the generator at build time. The `/design` page shows every generated value with its contrast ratio, and CI fails when a pair misses the ratios in §2.5.

### 2.2 Neutrals and accent
| Token | Derived from | Use |
|---|---|---|
| `--bg` | Base | Page background |
| `--surface` | Base in light; one step above it in dark | Cards, panels, table body |
| `--surface-2` | One step from `--surface` toward the text | Table header, sidebar, inset areas |
| `--surface-3` | Two steps from `--surface` toward the text | Hover rows, pressed states |
| `--text` | The high-contrast end of the ladder | Primary text |
| `--text-muted` | Ladder, AA on every surface | Secondary text, labels |
| `--text-subtle` | Ladder, 3:1 on every surface | Placeholders, metadata |
| `--border` | Ladder, one step from `--surface-2` | Default borders |
| `--border-strong` | Ladder, 3:1 against `--surface` | Inputs, focused containers |
| `--accent` | Accent | Buttons, active states, links on surfaces |
| `--accent-hover` | Accent, one step toward the text | Hover |
| `--accent-text` | Accent, adjusted to AA on `--surface` (lighter in dark) | Accent-coloured text |
| `--accent-fg` | `#FFFFFF` in both themes (4.7:1 on `#5E6AD2`) | Text on accent fills |
| `--accent-soft` | Accent at low chroma, near the base | Accent tints, selected rows |
| `--focus` | Accent | Focus ring (2 px, offset 2 px) |

### 2.3 Status
Status colours are fixed hues, not generated, and pass the same contrast check.

| Token | Light | Dark | Soft (light / dark) |
|---|---|---|---|
| `--success` | `#15803D` | `#4ADE80` | `#DCFCE7` / `#0F2E1A` |
| `--warning` | `#B45309` | `#FBBF24` | `#FEF3C7` / `#3A2A08` |
| `--danger` | `#B91C1C` | `#F87171` | `#FEE2E2` / `#3B1111` |
| `--info` | `#0369A1` | `#38BDF8` | `#E0F2FE` / `#0C2A3D` |

### 2.4 Domain status scales
| Scale | Tokens |
|---|---|
| Pipeline stages | `--stage-new` (`--text-subtle`), `--stage-contacted` (warning), `--stage-qualified` (accent), `--stage-quoted` (info), `--stage-won` (success), `--stage-lost` (danger) |
| SLA | `--sla-ok` (success), `--sla-warn` (warning), `--sla-breach` (danger) |
| Stock health | `--stock-healthy` (success), `--stock-low` (warning), `--stock-out` (danger), `--stock-reserved` (info) |
| Agent autonomy | `--auto-suggest` (info), `--auto-approve` (warning), `--auto-automatic` (success) |
| Entities | `--entity-1` … `--entity-4`: small identifying dots only; never as surfaces |

Charts use `--chart-1` … `--chart-6`, ordered for distinguishability in both themes: accent, info, success, warning, `#BE185D`/`#F472B6`, `--text-subtle`.

### 2.5 Contrast rules
- Body text on `--surface`: ≥ 4.5:1 (AA). Large text and UI components: ≥ 3:1.
- `--accent` is for fills and icons; `--accent-text` for text. Status text uses the base status colour on a soft tint.
- CI runs a contrast check over the generated tokens for both themes.

## 3. Typography
| Role | Family | Size / line height | Weight |
|---|---|---|---|
| Display | Inter, display optical size | 30 / 36 | 590 |
| H1 | Inter, display optical size | 24 / 32 | 590 |
| H2 | Inter, display optical size | 20 / 28 | 590 |
| H3 | Inter | 16 / 24 | 590 |
| Body | Inter | 14 / 20 | 400 |
| Body dense (grids, queues) | Inter | 13 / 18 | 400 |
| Caption / meta | Inter | 12 / 16 | 400–510 |
| Numeric | Inter, `font-variant-numeric: tabular-nums` | as body | 510 |

- Inter is self-hosted through `next/font` as a variable font with the optical-size axis, so headings get the display cut and the in-between weights 510 and 590 that Linear uses. `font-family: Inter, system-ui, sans-serif`.
- The root font size stays at the browser default, so a user's own text-size setting is respected; the body size is set on `body`.
- Letter spacing: 0 for body, `-0.01em` for headings ≥ 20 px.
- Never below 12 px. On phone layouts (below `md`), body is 15 / 22.

## 4. Spacing, radius, elevation, motion
- **Spacing scale** (4 px base): `--space-1` 4, `-2` 8, `-3` 12, `-4` 16, `-5` 20, `-6` 24, `-8` 32, `-10` 40, `-12` 48.
- **Radius:** `--radius-sm` 4 (chips, tags), `--radius-md` 6 (inputs, buttons), `--radius-lg` 8 (cards), `--radius-xl` 12 (dialogs).
- **Elevation:** borders first, shadows second. `--shadow-1` for popovers, `--shadow-2` for dialogs; both nearly invisible in dark mode where a `--border-strong` outline does the work.
- **Motion:** 120 ms for hover and toggles, 180 ms for panels, 240 ms for dialogs; `ease-out`. Respect `prefers-reduced-motion`.
- **Focus:** always visible: 2 px `--focus` ring with 2 px offset.

## 5. Layout
- **App shell:** 240 px sidebar (collapsible to 56 px icons), 48 px top bar with entity switcher, ⌘K search, notifications, Agent Inbox, Talk to Shakti mic, profile.
- **Content widths:** forms max 720 px; detail pages max 1200 px; grids and boards full width.
- **Breakpoints:** `sm` 640, `md` 768, `lg` 1024, `xl` 1280. Below `md` the sidebar becomes a sheet and tables become card lists.
- **Density modes:** `comfortable` (default) and `compact` (queues, grids). Row heights 40 / 32 px.
- **Phone gutters:** 16 px. No horizontal page scroll anywhere.

## 6. Component patterns
| Component | Rules |
|---|---|
| Button | Primary (accent fill), secondary (surface + border), ghost, danger. Height 36 px desktop, 44 px phone. Icon buttons are square. Loading state keeps width. |
| Input / select / date | 36 px, `--border-strong`, label above, helper or error below. Errors in `--danger` with icon. DD-MM-YYYY date picker. |
| Data grid | Sticky header, tabular numerals, right-aligned amounts, keyset "Load more", column chooser, row selection, saved views. Sortable columns show a single chevron. |
| Kanban board | Columns per stage using stage tokens on a 3 px top bar; cards show name, village, kW or HP, age, owner avatar, SLA dot. |
| Status badge | Soft tint background + base status text, 12 px, radius-sm. |
| Command palette (⌘K) | Groups: Go to, Search, Actions. Searches phone, name, village, document numbers, serials; tolerant of spelling variants of Indian names. |
| Dialog / sheet | Dialogs for confirmations and short forms; side sheets for records opened from grids. |
| Toast | Bottom-right desktop, top on phone; 4 s; actions allowed ("Undo", "Open"). |
| Empty state | One sentence, one primary action. |
| Skeletons | On every list and detail while loading; never spinners for content. |
| Caller workspace | Keyboard-first: number keys for dispositions, `N` next lead, `D` dial, `/` search. |
| Scheduling board | Day/week columns per engineer; conflicts outlined in `--danger`; unassigned queue on the right; map toggle. |
| Print templates | Light theme only, entity letterhead, A4 with 15 mm margins, Inter embedded, QR block bottom-right. |
| Public landing page | The root of the domain: product name, one line on what it does, and a "Staff sign in" button to `/sign-in`, which forwards a signed-in user to `/home`. The page reads no session and follows the visitor's system theme. |

## 7. Theme behaviour
- Default **System**; override **Light / Dark** from the profile menu, stored on the user profile and mirrored in a cookie for server rendering.
- `next-themes` with `attribute="data-theme"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`; inline pre-paint script prevents a flash.
- `color-scheme` is set on `:root` so native controls match. `<meta name="theme-color">` per scheme.
- Logos: light and dark variants per entity. Photos and maps get a 6% dim overlay in dark mode.
- The Android app reads the phone setting via `useColorScheme` and honours the same override from the profile.
- The public website follows the visitor's system setting.

## 8. Token delivery
`packages/tokens` holds the three theme inputs (§2.1), the fixed status and chart hues, and the LCH generator. Its build writes:
- `tokens.css`: `:root` light values, dark values under `:root:not([data-theme="light"])` inside `@media (prefers-color-scheme: dark)`, and again under `:root[data-theme="dark"]`.
- `tailwind.css`: Tailwind v4 `@theme` mapping (`--color-bg: var(--bg)` …) and shadcn/ui variable aliases (`--background`, `--foreground`, `--primary`, `--primary-foreground`, `--muted`, `--border`, `--ring`, `--destructive`).
- a typed object of the generated values, exported from the package for the Android app (NativeWind) and for chart colours.

```css
:root {
  /* neutrals generated from base #FFFFFF, accent #5E6AD2, contrast 30 */
  --bg: …; --surface: …; --surface-2: …; --surface-3: …;
  --text: …; --text-muted: …; --text-subtle: …; --border: …; --border-strong: …;
  --accent: #5E6AD2; --accent-hover: …; --accent-text: …; --accent-fg: #FFFFFF; --accent-soft: …;
  --focus: #5E6AD2;
  --success: #15803D; --warning: #B45309; --danger: #B91C1C; --info: #0369A1;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    /* neutrals generated from base #08090A, accent #5E6AD2, contrast 30 */
    --bg: …; --surface: …; /* … */
    --accent: #5E6AD2; --accent-text: …; --accent-fg: #FFFFFF; --focus: #5E6AD2;
    --success: #4ADE80; --warning: #FBBF24; --danger: #F87171; --info: #38BDF8;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] { /* identical to the dark block above */ }
```

## 9. Accessibility and formats
- WCAG AA: contrast, focus order, keyboard operability, labels on every control, `aria-live` for toasts and queue updates.
- English strings via `next-intl` from one catalogue; no concatenated sentences; plurals through ICU messages. `<html lang="en">` on every page.
- Numbers: ₹ with paise, lakh/crore grouping (`12,34,567.00`). Dates DD-MM-YYYY, times 24 h IST.
- Name search tolerates spelling variants of Indian names (trigram matching). Text a customer sends in Devanagari, such as a WhatsApp message, is shown as received with the device's own fonts.

## 10. Quality checks
- Contrast check over both themes in CI.
- Playwright visual snapshots of the role home pages, caller workspace, quote builder, scheduling board and print templates in light and dark.
- A preview page at `/design` in the BOS renders every token, type size and component in light and dark side by side, with the contrast ratio of each generated colour.
- Copy lint over the message catalogue, templates, caller scripts, voice prompts and print files (§11).

## 11. Voice and copy
The people who use Shakti Prime are tele-callers, store staff, engineers in the field, accountants, managers and farmers on WhatsApp. Copy is written for them. This rule covers every word a user can read or hear: screen labels, buttons, table headers, empty states, validation and error messages, success toasts, notifications, WhatsApp and email templates, PDFs and labels, help text, onboarding, caller scripts, and the voice assistant's replies. Screens, messages, emails and documents are in English; Hinglish is used only in the spoken channels of §11.5.

### 11.1 Rules
1. **Plain language.** Everyday words, short sentences, one idea per message, active voice. Say what happened, then what to do. English at a reading level a new tele-caller understands on day one.
2. **No technical words, ever.** The user never sees error codes, HTTP statuses, stack traces, table or column names, internal command names, vendor names, or developer vocabulary. Every domain error code maps to a plain sentence in the message catalogue. If the system cannot explain a failure simply, it says "Something went wrong on our side. Please try again in a minute." and shows a short reference number the support person can look up.
3. **Final, product-specific copy only.** No placeholder, sample, dummy or generic text anywhere a user can see it: no "Lorem ipsum", "TODO", "TBD", "Sample", "Test", "Placeholder", "Coming soon", "Foo", "Example", "Insert text here", and no invented names, phone numbers or amounts in templates, previews, seeds shown to users, screenshots or PDFs. Every string is the wording the product ships with.
4. **Consistent names.** One name per thing across the whole product: Lead, Customer, Site, Quote, Sales Order, Dispatch, Project, Proforma, Payment, Engineer visit, Price list, Stock, Kit, Serial number, Warranty claim. Never mix "opportunity" and "lead", or "SO" and "Sales Order", on screen.
5. **Numbers and dates the Indian way.** ₹ with lakh and crore grouping, DD-MM-YYYY, 24-hour IST, kW and HP with a space ("5 HP", "3.3 kW").
6. **Respectful and direct.** Customers are addressed by name with "ji" ("Ramesh ji") and, in Hinglish, as "aap"; staff messages use first names. No exclamation marks, no jargon, no blame ("Please check the phone number" rather than "Invalid input").
7. **One language per surface.** Everything shown on a screen, sent as a message or email, or printed is English. Hinglish appears only in the spoken channels of §11.5. A catalogue, template or print file containing a Devanagari character fails the build.

### 11.2 Banned words on screen
`error code`, `exception`, `stack trace`, `null`, `undefined`, `NaN`, `payload`, `request`, `response`, `API`, `webhook`, `token`, `session expired` (say "Please sign in again"), `sync failed` (say "Some changes haven't reached the office yet"), `cache`, `timeout`, `server`, `database`, `RLS`, `entity_id`, `DTO`, `JSON`, `UUID`, `invalid`, `unauthorized`, `forbidden`, `403`, `404`, `500`, `Supabase`, `Vercel`, `Meta`, `Exotel`, `LiveKit`, `Claude`, `Lorem ipsum`, `TODO`, `TBD`, `placeholder`, `sample`, `dummy`, `foo`, `bar`, `test`, `coming soon`.

### 11.3 Examples
| Situation | Copy |
|---|---|
| Save failed (network) | "We couldn't save this quote. Check your internet connection and try again." |
| Permission denied | "You don't have access to this. Ask your manager if you need it." |
| Stage move blocked | "Add the customer's village and pump depth before moving this lead to Qualified." |
| Credit block | "This order is on hold. Shree Traders has ₹1,20,000 overdue for more than 30 days. An Executive can release it." |
| Empty queue | "No calls due right now. New leads appear here as they come in." |
| Dispatch gate | "Enter the e-way bill number before this dispatch can leave the godown." |
| Field app offline | "You're offline. Your work is saved on this phone and will reach the office when you're back online." |
| WhatsApp visit confirmation | "Ramesh ji, engineer Suresh will visit on 14-10-2026 at 10 AM for your solar pump. Reply here if you need a different time." |
| Caller script opening (Hinglish) | "Namaste Ramesh ji, main Agro Solar Hub se Priya bol rahi hoon. Aapne solar pump ke baare mein poocha tha. Kya abhi do minute baat kar sakte hain?" |
| Unexpected failure | "Something went wrong on our side. Please try again in a minute. Reference: 8F3K2Q" |

### 11.4 Where copy lives and how it is checked
- All user-facing strings sit in the `next-intl` catalogue (`apps/web/messages/en.json`) and the field app catalogue, keyed by screen and purpose. Nothing is inlined in components.
- WhatsApp and email templates live in `packages/contracts/templates` in English with their approved Meta template names. Caller scripts and voice prompts live beside them in two variants, `hinglish` and `en`.
- Print and PDF templates take every string from the catalogue.
- The copy lint runs in CI over the catalogue, templates, caller scripts, voice prompts and print files: it fails on any banned word or placeholder pattern, on any Devanagari character, and on any string longer than the layout allows for its key.
- Copy review is part of the UAT sign-off per role: a real user of that role reads every screen, and a tele-caller reads every Hinglish script aloud.

### 11.5 Hinglish for spoken channels
- **Where:** tele-caller scripts and the Caller Co-pilot's suggested lines; the voice agent's speech on customer calls and in Talk to Shakti; training videos and live sessions.
- **Script:** Roman letters only, the way callers and customers type Hinglish on their phones. The speech engine may convert a line to Devanagari internally so it is pronounced correctly; that text is never shown, stored or logged.
- **Which variant:** a customer's `preferred_language` (`hinglish` by default, or `en`) picks the voice agent's language on their calls and the script variant a caller sees for them. It never changes screens, WhatsApp, SMS, email or documents, which are always English.
- **Spelling:** one spelling per word, so scripts read the same everywhere: aap, ji, haan, nahin, theek hai, dhanyavaad, abhi, kal, paise, bijli, kisan, kheti, sarkari yojana. Product and document names stay in English as in rule 4 (solar pump, quotation, subsidy, installation, Sales Order).
- **Tone:** spoken, warm and short, as a good caller talks: one question at a time, the customer's name with "ji", no English jargon a farmer would not use.
