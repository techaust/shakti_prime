# ADR 0009 — Chromium-rendered HTML for PDFs and print

**Status:** Proposed (2026-09-27; the week 6 Chromium spike on A4 PDFs and QR labels passed, `docs/spikes/print.md`; the hosting choice below is open) · **Blueprint:** §5, §8.3, §8.4, §8.8, §11.3, §17 · **Architecture:** §9 · **Design:** `DESIGN.md` §7, §11 · **ADR:** 0014

## Context
The BOS issues customer and statutory documents for four companies: quotes, proformas, delivery challans, handover kits and QR serial labels. Each carries the selling entity's letterhead, GSTIN and bank details, GST splits and lakh/crore formatting, and must look the same on screen, on paper and as a PDF sent on WhatsApp. A separate PDF library (drawing primitives or a React PDF renderer) would mean a second layout system beside the web app's CSS, a second set of fonts and tokens, and templates the on-screen print view cannot share. Documents are English only (ADR 0014), so no Devanagari shaping is needed.

## Decision
**Every document and label is an HTML template rendered by headless Chromium in a worker.**

- Templates live in `apps/web/src/print/*`, one per document type, written as plain functions that take the document's DTO and return an HTML string through the escaping builder in `html.ts`; they never read the database. The same template serves the on-screen print view, so what staff preview is what the customer receives.
- Rendering runs in the `/api/v1/workers/pdf/render` QStash worker (`PdfRenderJob` in `packages/contracts/src/api/worker-jobs.ts`), triggered by an outbox event after the document's command commits (ADR 0005). It launches Chromium through Playwright's library build with `page.pdf()` for A4 and a fixed page size for labels; output is stored in S3 (SSE-KMS) and linked to the record (`quotes.pdf_file_id` and its peers).
- **Always light:** print templates use the light token set whatever the viewer's theme (blueprint §11.3), with CSS print rules for margins, page breaks and repeated table headers.
- **Inter is embedded** from the app's own font files, never fetched at render time; QR codes are generated in the template as SVG.
- Money, dates and tax figures arrive already computed from the DTO (tax engine, ADR 0007); a template formats and never calculates.
- Every template has a **snapshot test**: a fixed DTO renders to a PDF whose page images are compared with the committed snapshot, so an unintended layout change fails CI (blueprint §17). The snapshot tests are set up with the production print module in Phase 1; until then `templates.test.ts` checks the templates' structure in the default run and the spike checks page counts, fonts and QR codes.
- The template and its catalogue strings pass the copy lint: final plain English, no placeholder text.

## Consequences
- One layout system and one token set for screen and paper; the design system's print rules are the only print rules.
- Chromium is heavy: the worker needs a function size and memory budget that fits it (Vercel `bom1` with a Chromium build for serverless, or a small container worker in ap-south-1). The spike's numbers are below; the choice between the two stays open until a render has been measured on Linux in each.
- Rendering is asynchronous: a document is usable once its PDF exists; the UI shows the print view at once and the PDF link when the worker finishes.
- Snapshot tests need a pinned Chromium version in CI so rendering differences come from template changes only.
- A document once issued is immutable: a correction issues a new version and a new PDF, never an overwrite.

## Week 6 spike outcome
Recorded in `docs/spikes/print.md`, with the raw numbers in `docs/spikes/results/print.json`. Passed on a Windows 11 laptop with `playwright-core` 1.63 and `chromium-headless-shell`; times are upper bounds, because other work ran on the same machine.

| Measure | Result |
|---|---|
| Browser launch, warm | 0.4 to 0.5 s (23.3 s the first time on a machine, while the new binary was scanned) |
| First document after launch | 1.7 s |
| 1-page quotation, median of 5 warm renders | 1.0 s, 161 KB |
| 5-page quotation (70 lines), median of 5 warm renders | 1.4 s (about 0.28 s a page), 253 KB |
| 100 labels in one PDF | 0.62 s at 50 × 25 mm (248 KB), 0.76 s at 100 × 50 mm (310 KB) |
| One label on its own, median of 20 | 0.39 s at 50 × 25 mm, 0.51 s at 100 × 50 mm |

All checks passed: page counts, only Inter embedded (with a text map on all 20 embedded fonts), the rupee sign drawn in Inter, lakh and crore grouping and DD-MM-YYYY dates, a white page whatever the viewer's theme, and every QR module sampled at 300 dpi matching the payload's module grid. Templates are plain HTML strings, not server components, so a print view can serve them without a React render. Chromium draws the variable Inter font as Type 3 glyphs, which adds about 0.2 s a document; static Inter files would embed as TrueType and save that time and about 60 KB.

Still open: the hosting (a Vercel function in `bom1` with a serverless Chromium package of about 60 MB compressed, a cold start of a few seconds and 1 to 2 GB of memory; or a small always-warm container worker in ap-south-1 fed by the same queue message); rendering on Linux; pixel snapshot tests in CI (with the production print module in Phase 1); the client's label printer and whether it takes PDF; a scan of the printed codes with a phone and the handheld scanner.
