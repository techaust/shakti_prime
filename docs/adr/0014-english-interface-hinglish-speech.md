# ADR 0014 — English interface, with Roman-script Hinglish only where people speak to customers

**Status:** Accepted (owner, 27-09-2026) · **Date:** 27-09-2026 · **Deciders:** Owner · **Blueprint:** §2, §5, §8.2, §8.6, §9.3, §11, §15 to §19 · **Design:** `DESIGN.md` §1, §9, §11 · **Database:** §2, §6.1, §6.2, §7 · **PRD:** TEL-01, WA-01, RPT-03, §5

## Context
Shakti Prime is used by tele-callers, store staff, field engineers, accountants and managers, and it talks to farmers and businesses on calls and WhatsApp. A second on-screen script doubles the copy to write, review and keep in step, and puts a translation step in front of every release. The group chose one interface language, English, and Hinglish for the channels where people speak to customers, because that is how callers and customers talk.

## Decision
- **English on every surface a person reads:** screens, buttons, errors, help tips, notifications, WhatsApp and SMS messages (milestone templates and the Concierge agent's replies), emails, and every PDF and label.
- **Roman-script Hinglish only in spoken channels:** tele-caller scripts and the Caller Co-pilot's suggested lines, the voice agent's speech on customer calls and in Talk to Shakti, and training videos and live sessions.
- **No Devanagari in the product's own text.** The speech adapter may convert a Hinglish line to Devanagari internally so it is pronounced correctly; that text is never shown, stored or logged. Text a customer writes in Devanagari is understood by the agents and shown as received.
- **Per-customer call language:** `contacts.preferred_language` is `hinglish` (default) or `en`. It selects the voice agent's language and the caller-script variant for that customer, and nothing else.
- **Schema:** one `name` column per record; no per-language name columns and no per-user locale. `next-intl` stays, with one English catalogue, so all copy still lives in one place and is checked by the copy lint.

## Consequences
- `apps/web/messages/hi.json`, locale detection, the `users.locale` column, every `name_hi` column and `LocaleSchema` leave the codebase; a forward-only migration drops the columns and changes the `preferred_language` check.
- The copy lint checks one catalogue plus the templates, caller scripts and voice prompts, and fails on any Devanagari character.
- Fonts: Inter only. PDFs and labels need no Devanagari shaping, so the week 6 print spike covers A4 PDF and QR label rendering.
- The speech benchmark gains a pass/fail criterion: natural pronunciation of Roman-script Hinglish, alongside Hindi, Hinglish and Rajasthani-accented recognition.
- Name search relies on trigram matching of spelling variants; no romanised shadow column is needed.
- Caller scripts and voice prompts are written in two variants, `hinglish` and `en`, with the spelling rules of `DESIGN.md` §11.5.
