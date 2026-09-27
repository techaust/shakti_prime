# Spike: OCR masking of Aadhaar and bank account numbers

**Week 6, ROADMAP §2.** Result: **passed on generated images; real document photos from the client still to run.** No real Aadhaar number, bank account or document was used.

Run it with `pnpm spike:ocr`. The first run fetches the English OCR model (2.9 MB, `eng.traineddata.gz` from the tesseract.js default source) once into `%LOCALAPPDATA%\shakti-prime\tesseract` (or `~/.cache/shakti-prime/tesseract`), outside the repository; the masking code itself only reads it from a local folder. The numbers are in [results/ocr.json](results/ocr.json) (ids, flags, counts and times only, no digits); the masked images, and only those, go to `apps/web/.spike-output/ocr/` (ignored by git). `--mode unknown_slot` or `--mode known_slot` runs one half and keeps the other half's numbers; `--only qr` (the photos with a QR code) and `--limit N` write to `results/ocr-subset.json` instead.

## What was built
| Part | Where |
|---|---|
| Verhoeff check digit (the Aadhaar checksum) | `packages/domain/src/privacy/verhoeff.ts` |
| Finding and masking Aadhaar and bank account numbers in text: twelve digits with any grouping and a correct check digit; twelve grouped digits with a wrong check digit are masked too (a misread digit must not leave eleven readable); nine to eighteen digits next to an account label on the same or the previous line; letters OCR reads for digits (O, l, S, B…) corrected for detection only; the first eight Aadhaar digits and all but the last four account digits become X | `packages/domain/src/privacy/identity-numbers.ts` |
| From OCR words and character boxes to the rectangles to cover and the masked text | `apps/web/src/workers/ocr/plan-masks.ts` |
| Finding every QR code on the photo and the rectangle that covers it: jsQR on the photo (or a copy at most 1000 px long), then, wherever square finder marks (dark or light) are left, on the full-size photo and the overlapping tiles holding a mark; a small photo is also read enlarged twice, contrast stretched and sharpened; three finder marks at the corners of a square place a code that cannot be decoded; each box is the code plus its quiet zone (four modules) and a tenth of its side, at least 8 px, kept inside the photo; the payload is wiped at once and never kept | `apps/web/src/workers/ocr/qr-cover.ts` |
| When a photo is held for review instead of returned | `apps/web/src/workers/ocr/review.ts` |
| The masking worker: `createDocumentMasker({ langPath })` then `mask(photo, { expect })` | `apps/web/src/workers/ocr/mask-document.ts` |
| Generator of made-up document photos (in memory only) and the spike runner | `apps/web/scripts/spike/ocr-documents.ts`, `apps/web/scripts/spike/ocr.ts` |

How `mask` works:
1. Turns the photo upright (camera orientation), then **overwrites the caller's buffer with zeros**.
2. Reads the photo up to four ways with tesseract.js (English, LSTM): upscaled to at least 1600 px wide and sharpened, as a page, as scattered text and as one block; and at its own size as one block. A number found by any reading is covered.
3. Finds every QR code on the photo, whatever it holds (an Aadhaar code can carry the full number), as described in the table above.
4. Draws opaque boxes over the hidden digits (from the OCR's character boxes, padded) and over every QR code found, and re-encodes as JPEG without metadata.
5. Returns `masked` or `clean` with the masked image, the masked text and the last four digits; or `needs_review` with **no image and no text** when the photo reads like an Aadhaar card ("Aadhaar", "Government of India", "UIDAI", "VID" and common misreadings) or the upload slot expects a number (`expect: ['aadhaar']` or `['bank_account']`) and no number was found (`number_not_found`), or when the photo is an Aadhaar document (the slot says so, it reads like one, or an Aadhaar number was found on it) and a QR finder mark lies outside every cover box (`qr_not_covered`).
6. Every intermediate buffer is zeroed; nothing is written to disk or to a log.

## The test set
30 made-up photos, the same for every run (fixed seed): 12 identity cards (the number spaced or unspaced, some with a sixteen-digit VID line), 4 letters with the number in a sentence (unspaced or hyphenated), 4 bank passbooks (label on the same line or above), 3 forms with both an Aadhaar number and an account number, 4 electricity bills (a twelve-digit consumer number with a wrong check digit, a thirteen-digit K number, a mobile number, one with a sixteen-digit card number) and 3 quotations. Ten fonts, rotation ±5°, blur up to 1.4 px, grain, JPEG quality 35 to 90, 900 to 2400 px wide. Every fifth photo is **hard**: 650 to 850 px wide, blur 1.6 to 2.4 px, heavy grain, JPEG quality 20 to 34, as a forwarded phone picture. The cards imitate no real card design (no emblem, photo or Hindi text). Seven of the twelve cards (both hard cards among them) and two of the four letters carry a made-up QR code, 41 to 65 modules a side, holding a made-up record with the card's made-up number: readable text, or a long run of digits as on the denser codes of newer letters.

Each photo is masked twice: as a photo of unknown kind (a WhatsApp upload) and as an upload to a slot that says what it holds (cards expect an Aadhaar number, passbooks an account number). After masking, the masked image is read again by a separate OCR pass and the hidden digits are searched for in that reading and in the returned text. Every returned image is also searched for any QR code jsQR can decode, independently of the masker's scan: the whole image (dark and light codes), a smaller and a larger copy, the four quarters enlarged, on an image up to 1300 px nine tiles enlarged three times, contrast stretched and sharpened, and a crop around the drawn code enlarged one to four times, plain and sharpened. The same search on the unmasked photo gives the baseline. Only masked images that pass every check are written to disk.

## Numbers
Windows 11 laptop, 4 cores, Node 24.19, tesseract.js 7 with `eng` 4.0.0 best_int. Other workstreams were running on the same machine, so treat the times as upper bounds: the two columns come from two runs one after the other (`pnpm spike:ocr --mode unknown_slot`, then `--mode known_slot`), because one run of both took over nine minutes, and the same photo's QR scan took 15.5 s in one run and 6.1 s in the other.

| Measure | Photo of unknown kind | Upload slot known |
|---|---|---|
| Aadhaar numbers masked with the correct last four, photo returned | 17 of 19 (89.5%) | 17 of 19 (89.5%) |
| Bank account numbers masked with the correct last four | 6 of 7 (85.7%) | 6 of 7 (85.7%) |
| Normal photos: numbers masked | 22 of 22 | 22 of 22 |
| Hard photos: numbers masked, photo returned | 1 of 4 | 1 of 4 |
| Held for review (nothing returned) | 2 (hard card with no number found; hard card whose QR code could not be covered) | 3 (the same two, hard passbook) |
| **Returned with a number left readable** | **1 (hard passbook, account number)** | **0** |
| False positives on the 7 photos without such numbers | 0 | 0 |
| Numbers masked that were not there | 0 | 0 |
| Hidden digits found in the returned text | 0 | 0 |
| Hidden digits found by re-reading the masked image | 0 | 0 |
| QR codes drawn / decodable on the photo before masking | 9 / 8 | 9 / 8 |
| QR codes found and covered on returned photos | 7 of 7, each wholly under its box | 7 of 7, each wholly under its box |
| Held because a QR code could not be covered | 1 (hard card) | 1 (hard card) |
| **Returned with a QR code left uncovered** | **0** | **0** |
| **QR codes decodable on the returned images** | **0** | **0** |
| QR cover boxes on photos without a QR code | 0 | 0 |
| Time added by the QR scan per photo, mean / p50 / p95 / max | 1.7 / 0.8 / 5.2 / 15.5 s | 1.1 / 0.5 / 5.0 / 6.1 s |
| Time per photo, mean / p50 / p95 / max | 5.1 / 3.9 / 9.8 / 19.0 s | 3.5 / 2.8 / 7.1 / 7.7 s |
| Loading the OCR engine (once per worker) | 1.0 s | 0.6 s |

The re-reading check uses OCR, so it proves only what OCR can read. On the one returned miss (the hard passbook, unknown kind) OCR could not read the account number either, but a person can: that photo counts as a leak of a bank account number, and it is the reason to pass `expect` whenever the upload slot is known. With the slot known it was held for review.

Reading every photo four ways costs time. An earlier version on the same set (one reading, a second only when the first found nothing) took about 1.6 s per photo, masked 1 of the 4 numbers on hard photos and returned one hard card with its Aadhaar number readable to a person and to OCR. Four readings mask 2 of 4 (one of them, a hard card, is then held because its QR code cannot be covered) and, with the slot known, hold the other two for review. The time is spent in a background worker, not while a person waits.

## Against the blueprint
| Expectation | Status |
|---|---|
| OCR (tesseract.js in workers) finds Aadhaar and bank account numbers (BLUEPRINT §5) | Met on generated photos |
| First eight Aadhaar digits masked on the image and in the text; only the last four and the masked copy kept; the original discarded (BLUEPRINT §7.5, SECURITY §5) | Met: the caller's buffer is zeroed; only the masked JPEG, masked text and last four digits are returned |
| Aadhaar digits never in storage, logs or LLM payloads (BLUEPRINT §17, SECURITY §11 item 8) | Met for this code path: nothing is logged or written except the masked output. The spike's own inputs exist only in memory |
| OCR masking on **real document photos** (ROADMAP §2 week 6) | **Not done**: needs photos from the client, handled under their consent, run on their premises or a machine they approve |

## What remains before production
- **Real photos.** Run the same script over real, consented photos (Aadhaar cards front and back, e-Aadhaar letters, passbooks, cancelled cheques, taken on the phones the field staff use). Real cards print Hindi text and a photo, which the generated set does not have, and their QR codes follow UIDAI's formats rather than the made-up records drawn here.
- **The QR code on Aadhaar cards.** Resolved on generated images; real document photos from the client still to run. Older cards and e-Aadhaar letters carry a QR code that can hold the full number, so every QR code on a photo is covered whatever it holds, and an Aadhaar photo with a finder mark outside every cover box is held for review. Limits: a code with modules under about 1.3 px on a photo longer than 1300 px, and a code too blurred for its finder marks to be seen, are not found (the hard card whose code no reading could decode was held for its number; had its number been read, it would have been returned with that unreadable code uncovered). jsQR is the only decoder tried.
- **Hard photos.** Three of six hard photos are held for review with the slot known (two with no number found, one whose QR code could not be covered), which is safe but means a person asks the customer for a better photo. The rate on real photos decides whether that is acceptable.
- **Where it runs.** tesseract.js core is about 44 MB with its WebAssembly builds, plus the 2.9 MB model, which must be bundled with the worker (the worker must never download it while handling a document). CPU time of 3 to 10 s per photo (the QR scan adds 0.5 to 5 s) suits a background worker (the same one as PDF rendering, ADR 0009) better than a Vercel function.
- **Wiring.** The upload flow (ARCHITECTURE §9: scan and mask before `ready`), the `needs_review` path and the message a person sees, and the command that stores the last four digits.

## Not verified
- Any real document photo.
- Handwritten numbers, numbers split across two lines, photos rotated by more than 5°, or upside down.
- Documents in other scripts.
- Performance on Linux or on the target worker.
