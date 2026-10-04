# ADR 0009 — Chromium-rendered HTML for PDFs and print

**Status:** Proposed (2026-09-27; the week 6 Chromium spike on A4 PDFs and QR labels passed its rendering checks, `docs/spikes/print.md`; the hosting chosen on 29-09-2026 and built in Phase 1 (P4, `docs/design/phase1.md` §6.4) as below; a phone and scanner check of printed labels and a render measured on the dev deployment are open) · **Blueprint:** §5, §8.3, §8.4, §8.8, §11.3, §17 · **Architecture:** §9 · **Design:** `DESIGN.md` §7, §11 · **ADR:** 0014

## Context
The BOS issues customer and statutory documents for four companies: quotes, proformas, delivery challans, handover kits and QR serial labels. Each carries the selling entity's letterhead, GSTIN and bank details, GST splits and lakh/crore formatting, and must look the same on screen, on paper and as a PDF sent on WhatsApp. A separate PDF library (drawing primitives or a React PDF renderer) would mean a second layout system beside the web app's CSS, a second set of fonts and tokens, and templates the on-screen print view cannot share. Documents are English only (ADR 0014), so no Devanagari shaping is needed.

## Decision
**Every document and label is an HTML template rendered by headless Chromium in a worker.**

- Templates live in `apps/web/src/print/*`, one per document type, written as plain functions that take the document's DTO and return an HTML string through the escaping builder in `html.ts`; they never read the database. The same template serves the on-screen print view, so what staff preview is what the customer receives.
- Rendering runs in the `/api/v1/workers/pdf/render` QStash worker (`PdfRenderJob` in `packages/contracts/src/api/worker-jobs.ts`), triggered by the outbox event `print.document.requested` after the document's command commits (ADR 0005); the publisher sends that event to the route as its job (`EVENT_JOB_ROUTES` in `apps/web/src/workers/qstash.ts`), with the event id as its key, and without a queue the same job runs in the process that committed it. The worker loads the document through the loader its type registers in `apps/web/src/print/documents.ts`, as `system:workers` of the selling company alone, and launches Chromium through `playwright-core` (`chromiumForRuntime()`: the serverless build `@sparticuz/chromium` 153 on Vercel, the Chromium Playwright installed on the machine elsewhere) with `page.pdf()` for A4 and a fixed page size for labels; the PDF is stored through the file store (S3 with SSE-KMS) under its purpose and file id, recorded `ready` by `files.document.record` and attached to its record (`quotes.pdf_file_id` and its peers, with their slices). A render that fails is retried by QStash and comes back as the event's dead letter on Integration Health.
- **Always light:** print templates use the light token set whatever the viewer's theme (blueprint §11.3), with CSS print rules for margins, page breaks and repeated table headers.
- **Inter is embedded** from the app's own font files, never fetched at render time; QR codes are generated in the template as SVG.
- Money, dates and tax figures arrive already computed from the DTO (tax engine, ADR 0007); a template formats and never calculates.
- Every template has a **snapshot test**: `apps/web/e2e/print.spec.ts` opens each template's page with fixed data (written by the journeys' seed, `e2e/setup/print-pages.ts`) and compares it with its baseline in the pinned Linux Playwright image, so an unintended layout change fails CI (blueprint §17); `templates.test.ts` checks the templates' structure in the default run, and the spike checks page counts, fonts and QR codes.
- The template and its catalogue strings pass the copy lint: final plain English, no placeholder text.

## Consequences
- One layout system and one token set for screen and paper; the design system's print rules are the only print rules.
- Chromium is heavy: the render route is a Vercel function in `bom1` with a `maxDuration` of 60 seconds and the plan's default 2 GB of memory, and the serverless Chromium (`bin/*.br`, about 60 MB, unpacked on a cold start) travels with that route alone (`outputFileTracingIncludes` in `apps/web/next.config.ts`, with `playwright-core` and `@sparticuz/chromium` in `serverExternalPackages`); the always-warm container worker in ap-south-1 stays the fallback if the render measured on the dev deployment misses its time.
- Rendering is asynchronous: a document is usable once its PDF exists; the UI shows the print view at once and the PDF link when the worker finishes.
- Snapshot tests need a pinned Chromium version in CI so rendering differences come from template changes only.
- A document once issued is immutable: a correction issues a new version and a new PDF, never an overwrite.

## Week 6 spike outcome
Recorded in `docs/spikes/print.md`, with the raw numbers in `docs/spikes/results/print.json`. Passed on a Windows 11 laptop with `playwright-core` 1.63 and `chromium-headless-shell`; times are upper bounds, because other work ran on the same machine.

| Measure | Result |
|---|---|
| Browser launch, warm | 0.5 s (523 ms in the result file); 23.3 s seen once, the first time on the machine, while the new binary was scanned, and not in the result file |
| First document after launch | 1.7 s |
| 1-page quotation, median of 5 warm renders | 1.0 s, 161 KB |
| 5-page quotation (70 lines), median of 5 warm renders | 1.4 s (about 0.28 s a page), 253 KB |
| 100 labels in one PDF | 0.62 s at 50 × 25 mm (248 KB), 0.76 s at 100 × 50 mm (310 KB) |
| One label on its own, median of 20 | 0.39 s at 50 × 25 mm, 0.51 s at 100 × 50 mm |

All checks passed: page counts, only Inter embedded (with a text map on all 20 embedded fonts), the rupee sign drawn in Inter, lakh and crore grouping and DD-MM-YYYY dates, a white page whatever the viewer's theme, and every QR module sampled at 300 dpi matching the payload's module grid. Templates are plain HTML strings, not server components, so a print view can serve them without a React render. Chromium draws the variable Inter font as Type 3 glyphs, which adds about 0.2 s a document; static Inter files would embed as TrueType and save that time and about 60 KB.

Hosting, decided by the owner on 29-09-2026 (`docs/design/phase1.md` §2) and built in P4: a Vercel function in `bom1` running `playwright-core` 1.63 with the serverless Chromium package `@sparticuz/chromium` 153 (about 60 MB compressed, a cold start of a few seconds, 1 to 2 GB of memory), measured on the dev deployment before quotes depend on it; the always-warm container worker in ap-south-1 stays the fallback if that measure fails. In the app on the development laptop (no queue, so the render runs in the process that asked), a company's proof page renders in 1.5 seconds with the browser's launch and 0.8 seconds warm, 78 KB. Still open: the render measured on the dev deployment; the client's label printer and whether it takes PDF; a scan of the printed codes with a phone and the handheld scanner.
