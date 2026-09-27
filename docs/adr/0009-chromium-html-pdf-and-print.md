# ADR 0009 — Chromium-rendered HTML for PDFs and print

**Status:** Proposed (2026-09-27; confirmed by the week 6 Chromium spike on A4 PDFs and QR labels) · **Blueprint:** §5, §8.3, §8.4, §8.8, §11.3, §17 · **Architecture:** §9 · **Design:** `DESIGN.md` §7, §11 · **ADR:** 0014

## Context
The BOS issues customer and statutory documents for four companies: quotes, proformas, delivery challans, handover kits and QR serial labels. Each carries the selling entity's letterhead, GSTIN and bank details, GST splits and lakh/crore formatting, and must look the same on screen, on paper and as a PDF sent on WhatsApp. A separate PDF library (drawing primitives or a React PDF renderer) would mean a second layout system beside the web app's CSS, a second set of fonts and tokens, and templates the on-screen print view cannot share. Documents are English only (ADR 0014), so no Devanagari shaping is needed.

## Decision
**Every document and label is an HTML template rendered by headless Chromium in a worker.**

- Templates live in `apps/web/src/print/*`, one per document type, written as server components that take the document's DTO and nothing else; they never read the database. The same template serves the on-screen print view, so what staff preview is what the customer receives.
- Rendering runs in the `/api/v1/workers/pdf/render` QStash worker, triggered by an outbox event after the document's command commits (ADR 0005). It launches Chromium through Playwright's library build with `page.pdf()` for A4 and a fixed page size for labels; output is stored in S3 (SSE-KMS) and linked to the record (`quotes.pdf_file_id` and its peers).
- **Always light:** print templates use the light token set whatever the viewer's theme (blueprint §11.3), with CSS print rules for margins, page breaks and repeated table headers.
- **Inter is embedded** from the app's own font files, never fetched at render time; QR codes are generated in the template as SVG.
- Money, dates and tax figures arrive already computed from the DTO (tax engine, ADR 0007); a template formats and never calculates.
- Every template has a **snapshot test**: a fixed DTO renders to a PDF whose page images are compared with the committed snapshot, so an unintended layout change fails CI (blueprint §17).
- The template and its catalogue strings pass the copy lint: final plain English, no placeholder text.

## Consequences
- One layout system and one token set for screen and paper; the design system's print rules are the only print rules.
- Chromium is heavy: the worker needs a function size and memory budget that fits it (Vercel `bom1` with a Chromium build for serverless, or a small container worker if the spike shows cold starts above the budget). The week 6 spike measures cold and warm render time for an A4 quote and a label sheet and records the choice.
- Rendering is asynchronous: a document is usable once its PDF exists; the UI shows the print view at once and the PDF link when the worker finishes.
- Snapshot tests need a pinned Chromium version in CI so rendering differences come from template changes only.
- A document once issued is immutable: a correction issues a new version and a new PDF, never an overwrite.
