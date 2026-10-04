# Spike: Chromium A4 PDFs and QR labels

**Week 6, ROADMAP §2.** Result: **the rendering checks passed on the development laptop (27-09-2026).** A scan of printed labels with a phone and the client's handheld scanner is still to do.

**Status (04-10-2026):** rendering passed; the phone and scanner check waits for the client's printer and label stock (owner: the developer, with the printer supplier). The deployment question below was settled by ADR 0009, accepted by the owner on 29-09-2026: documents render in a Vercel function in `bom1` with `playwright-core` and `@sparticuz/chromium`, measured on the dev deployment before quotes depend on it. Built in P4: in the app on the development laptop (no queue, so the render runs in the process that asked), a company's proof page renders in 1.5 seconds with the browser's launch and 0.8 seconds warm, 78 KB; the render on the dev deployment is still to measure.

Run it with `pnpm spike:print` (once per machine first: `pnpm --filter web exec playwright-core install chromium-headless-shell`). The raw numbers are in [results/print.json](results/print.json); the PDFs and PNGs go to `apps/web/.spike-output/print/` (ignored by git).

## What was built
| Part | Where |
|---|---|
| A4 quotation template: entity letterhead, customer block, line table with a header row repeated on every page, tax totals, amount in words, terms, signatory, QR block bottom-right, footer with the entity, the quotation number and "Page X of Y" | `apps/web/src/print/quote-template.ts` |
| QR label template, 50 × 25 mm and 100 × 50 mm, one label per page at the stock size | `apps/web/src/print/label-template.ts` |
| Shared print styles: Inter embedded from local files as data URLs, the light theme's colour tokens generated from `@shakti/tokens`, no dark rules | `apps/web/src/print/styles.ts`, `apps/web/src/print/fonts/` |
| Rupees with lakh and crore grouping from the money string itself (no floating point), DD-MM-YYYY in IST | `apps/web/src/print/format.ts` |
| Printed words from the catalogue (`print.*` in `apps/web/messages/en.json`), so the copy lint checks them | `apps/web/src/print/copy.ts` |
| Escaping HTML builder (a customer's name cannot become markup) | `apps/web/src/print/html.ts` |
| Renderer on `playwright-core`: `renderPdf(html, options)` (A4, margins, header and footer, page numbers), `renderLabel(html, size)`, `renderImage` for checks; the page runs with a CSP of `default-src 'none'`, the browser context is offline and every non-`data:` URL is refused | `apps/web/src/print/renderer.ts` |
| Spike data (made-up customer, amounts worked out in whole paise only to read consistently) | `apps/web/src/print/fixtures/spike-documents.ts` |

Templates receive already computed money strings and format them; they never add, multiply or round.

## Checks (all passed)
| Check | Result |
|---|---|
| 1-page quotation (7 lines) prints on one A4 page | 1 page |
| 5-page quotation prints on five pages | 5 pages, 70 lines |
| Only Inter is embedded | Inter, Inter-Medium, Inter-SemiBold, and the optical-size cuts Inter-16pt-SemiBold and Inter-20pt-SemiBold |
| Every embedded font has a text map (text can be searched and copied) | 20 of 20 |
| Rupee sign drawn in Inter, not a fallback font | yes |
| Quotation number, customer, dates (27-09-2026), total (₹5,40,112.00) and amount in words present | yes |
| Light background whatever the viewer's setting | `rgb(255, 255, 255)` |
| 100 labels at 50 × 25 mm and 100 at 100 × 50 mm | 100 pages each |
| QR codes: every printed module sampled at 300 dpi matches the module grid of the payload (quotation and both label sizes) | 0 modules differ |

The QR check compares the rendered pixels with the grid `qrcode` builds for the payload, so it proves the printed code is the intended code. A scan with a phone camera and with the client's handheld scanner has not been done.

## Numbers
Windows 11 laptop, Node 24.19, playwright-core 1.63 with `chromium-headless-shell` (build 1243). Other workstreams were running on the same machine, so treat the times as upper bounds.

| Measure | Time | Size |
|---|---|---|
| Browser launch, warm machine | 0.5 s (523 ms in the result file) | |
| Browser launch, first ever on the machine | 23.3 s, seen once and not in the result file (disk and antivirus scan of the new binary) | |
| First document after launch | 1.7 s | |
| 1-page quotation, median of 5 warm renders | 1.0 s | 161 KB |
| 5-page quotation, median of 5 warm renders | 1.4 s, about 0.28 s per page | 253 KB |
| 100 labels 50 × 25 mm in one PDF | 0.62 s, 6.2 ms per label | 248 KB |
| 100 labels 100 × 50 mm in one PDF | 0.76 s, 7.6 ms per label | 310 KB |
| One label on its own, median of 20 | 0.39 s (50 × 25), 0.51 s (100 × 50) | |

Where the time goes, for the 1-page quotation: loading the page with the inlined fonts about 0.3 s, Chromium's PDF step about 0.55 s with any font, plus about 0.2 s because Chromium draws the variable Inter font as Type 3 glyphs (it cannot embed a variable font as TrueType). The footer's own copy of the font costs nothing measurable.

## Against the blueprint and DESIGN.md
| Expectation | Status |
|---|---|
| HTML templates rendered by headless Chromium, in English, Inter embedded (BLUEPRINT §5) | Met |
| Printed and shared outputs always light (BLUEPRINT §11, DESIGN §1 rule 6) | Met: only the light tokens are in the stylesheet, and the renderer forces the light scheme |
| Light theme, entity letterhead, A4 with 15 mm margins, Inter embedded, QR block bottom-right (DESIGN §6) | Met; bottom margin is 18 mm to make room for the page footer |
| ₹ with lakh and crore grouping, DD-MM-YYYY (DESIGN §9, §11.1) | Met |
| Every printed word from the catalogue (DESIGN §11.4) | Met: `print.*` keys, checked by the copy lint |
| The same templates drive print views and labels (BLUEPRINT §5) | Partly: the templates are plain HTML strings, so a print view can serve them, but no screen uses them yet |
| Snapshot tests of quotes and labels (BLUEPRINT §17) | Structure tests in the default run (`templates.test.ts`); page counts, fonts and QR checks in the spike. Pixel snapshots are not set up |
| A spike result with latency numbers (ROADMAP §2 exit gate) | Met, above |

## What deployment needs (settled by ADR 0009 on 29-09-2026: option 1)
The renderer needs a Chromium binary next to it. The two ways weighed:

1. **In a Vercel function** (`bom1`). Chromium does not ship with the Node runtime; the usual route is a packaged Chromium for serverless (for example `@sparticuz/chromium`, about 60 MB compressed), which uses most of the 250 MB function limit, adds a cold start of a few seconds on top of the 0.5 s launch measured here (523 ms in the result file), and needs 1 to 2 GB of memory. It keeps everything on one platform.
2. **In a separate worker** (a small container in ap-south-1, for example on the same AWS account as S3), fed by the QStash event that already carries the document id, with the Playwright image (Chromium included). The browser stays warm between jobs, so a quotation costs about 1 s and a batch of 100 labels under 1 s. It is one more service to run.

Also to decide:
- **Font files.** Variable Inter is drawn as Type 3 fonts in the PDF (searchable, prints correctly); static Inter files embed as TrueType and cut about 60 KB and 0.2 s per document, so P4 prints with the static Regular, Medium and SemiBold files of Inter 4.1. The Inter licence (SIL Open Font License 1.1) sits next to the font files in `apps/web/src/print/fonts/OFL.txt`.
- **Label printers.** The client's thermal printer model, its driver (does it take PDF, or does it need ZPL or TSPL), and the label stock sizes. The spike assumes PDF at the stock size.
- **Long item names** on the 50 × 25 mm label are cut after two lines with an ellipsis.

## Not verified
- Rendering on Linux or in a Vercel function; everything above ran on Windows.
- The look of pages 2 to 5: the header row is set to repeat and rows are set not to split across pages (`thead` as a table header group, `break-inside: avoid`), but no page image of the PDF was inspected.
- Printing on paper and on a thermal printer; scanning the codes with a phone.
- Pixel snapshot tests in CI.
- Documents of other entities (letterheads with logos: no logo files exist yet).
