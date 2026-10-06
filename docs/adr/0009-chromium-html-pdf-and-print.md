# ADR 0009 — Chromium-rendered HTML for PDFs and print

**Status:** Accepted (owner, 29-09-2026); proposed 27-09-2026; built in Phase 1 (P4, `docs/03-roadmap-appendix/phase1.md` §6.4). The spike's outcome and the checks still open are in `docs/04-architecture-appendix/print.md` · **Date:** 27-09-2026 · **Deciders:** Owner · **Blueprint:** §5, §8.3, §8.4, §8.8, §11.3, §17 · **Architecture:** §9 · **Design:** `docs/08-design-system.md` §7, §11 · **ADR:** 0014

## Context
The BOS issues customer and statutory documents for four companies: quotes, proformas, delivery challans, handover kits and QR serial labels. Each carries the selling entity's letterhead, GSTIN and bank details, GST splits and lakh/crore formatting, and must look the same on screen, on paper and as a PDF sent on WhatsApp.

A separate PDF library (drawing primitives or a React PDF renderer) would mean a second layout system beside the web app's CSS, a second set of fonts and tokens, and templates the on-screen print view cannot share. Documents are English only (ADR 0014), so no Devanagari shaping is needed.

## Decision
**Every document and label is an HTML template rendered by headless Chromium in a worker.**

- Templates live in `apps/web/src/print/*`, one per document type, written as plain functions that take the document's DTO and return an HTML string through the escaping builder in `html.ts`; they never read the database. The same template serves the on-screen print view, so what staff preview is what the customer receives.
- Rendering runs in the `/api/v1/workers/pdf/render` QStash worker (`PdfRenderJob` in `packages/contracts/src/api/worker-jobs.ts`), triggered by the outbox event `print.document.requested` after the document's command commits (ADR 0005); the publisher sends that event to the route as its job (`EVENT_JOB_ROUTES` in `apps/web/src/workers/qstash.ts`), with the event id as its key, and without a queue the same job runs in the process that committed it. The worker loads the document through the loader its type registers in `apps/web/src/print/documents.ts`, as `system:workers` of the selling company alone, and launches Chromium through `playwright-core` (`chromiumForRuntime()`: the serverless build `@sparticuz/chromium` 153 on Vercel, the Chromium Playwright installed on the machine elsewhere) with `page.pdf()` for A4 and a fixed page size for labels; the PDF is stored through the file store (S3 with SSE-KMS) under its purpose and file id, recorded `ready` by `files.document.record` and attached to its record (`quotes.pdf_file_id` and its peers, with their slices). A render that fails is retried by QStash and comes back as the event's dead letter on Integration Health.
- **Always light:** print templates use the light token set whatever the viewer's theme (blueprint §11.3), with CSS print rules for margins, page breaks and repeated table headers.
- **Inter is embedded** from the app's own static font files (Regular, Medium and SemiBold of Inter 4.1, each covering a band of weights), never fetched at render time; QR codes are generated in the template as SVG.
- Money, dates and tax figures arrive already computed from the DTO (tax engine, ADR 0007); a template formats and never calculates.
- Every template has a **snapshot test**: `apps/web/e2e/print.spec.ts` opens each template's page with fixed data (written by the journeys' seed, `e2e/setup/print-pages.ts`) under print media emulation and compares it with its baseline in the pinned Linux Playwright image, so an unintended layout change fails CI (blueprint §17); `templates.test.ts` checks the templates' structure in the default run. The baselines are of the HTML page, not of the PDF Chromium writes, so the PDF's footer (brand, page numbers, printed-on date) and its page breaks are not compared; a rasterised check of a real PDF's first page is an open follow-up ([STATUS](../10-status.md#open-follow-ups)).
- The template and its catalogue strings pass the copy lint: final plain English, no placeholder text.

## Consequences
- One layout system and one token set for screen and paper; the design system's print rules are the only print rules.
- Chromium is heavy: the render route is a Vercel function in `bom1` with a `maxDuration` of 60 seconds and the plan's default 2 GB of memory, and the serverless Chromium (`bin/*.br`, about 60 MB, unpacked on a cold start) travels with that route alone (`outputFileTracingIncludes` in `apps/web/next.config.ts`, with `playwright-core` and `@sparticuz/chromium` in `serverExternalPackages`); a render is measured on the dev deployment before quotes depend on it, and the always-warm container worker in ap-south-1 stays the fallback if it misses its time.
- Rendering is asynchronous: a document is usable once its PDF exists; the UI shows the print view at once and the PDF link when the worker finishes.
- Snapshot tests need a pinned Chromium version in CI so rendering differences come from template changes only.
- A document once issued is immutable: a correction issues a new version and a new PDF, never an overwrite.

## Outcome
Outcome: see [`docs/04-architecture-appendix/print.md`](../04-architecture-appendix/print.md) for the week 6 spike's measures, the hosting the owner chose on 29-09-2026 ([design §2](../03-roadmap-appendix/phase1.md#2-decisions-taken-with-the-owner-on-29-09-2026)) and the checks still open.
