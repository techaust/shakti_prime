import type { LabelKind } from '@shakti/contracts';

/**
 * What a BOS label's QR code carries (Q1, docs/03-roadmap-appendix/phase3.md §7.4):
 * `SP1:<letter>:<id>`, the version `SP1`, `S` for a serial, `B` for a bin or `P` for a dispatch
 * package, and the record's id. Nothing else is printed into the code, so a label read by a
 * stranger's phone tells them nothing, and a label stays right when a name or code changes.
 */

const LETTER: Readonly<Record<LabelKind, string>> = { serial: 'S', bin: 'B', package: 'P' };
const KIND_OF: Readonly<Record<string, LabelKind>> = { S: 'serial', B: 'bin', P: 'package' };

/** The ids the BOS makes: UUID version 7, as `IdSchema` takes them. */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Any version of our own labels: `SP`, a version number and `:`. */
const OURS = /^SP\d+:/i;

/** A scanned code at most this long is read; anything longer is no label of ours. */
const MAX_CODE = 400;

/** The QR payload of a label: `SP1:S:<serial id>`, `SP1:B:<bin id>`, `SP1:P:<package id>`. */
export function labelPayload(kind: LabelKind, id: string): string {
  const lower = id.toLowerCase();
  if (!ID.test(lower)) throw new RangeError('a label names a record by its id');
  return `SP1:${LETTER[kind]}:${lower}`;
}

/**
 * What a scanned code says:
 * - `label`: a label of ours, its kind and the record's id;
 * - `unknown`: it looks like ours (`SP<n>:`) but no label of this version is written so: another
 *   version, a letter we do not print, or an id that is not one of ours;
 * - `foreign`: any other code, such as a supplier's barcode or a web address.
 *
 * A handheld scanner types the code and often an Enter or a Tab after it, and some send it in
 * capitals, so the code is trimmed and its prefix read in any case.
 */
export type ParsedLabel =
  { kind: 'label'; labelKind: LabelKind; id: string } | { kind: 'unknown' } | { kind: 'foreign' };

export function parseLabelPayload(code: string): ParsedLabel {
  const text = code.trim();
  if (text.length === 0 || text.length > MAX_CODE || !OURS.test(text)) return { kind: 'foreign' };
  const parts = text.split(':');
  if (parts.length !== 3) return { kind: 'unknown' };
  const [version, letter, rawId] = parts as [string, string, string];
  const upper = letter.toUpperCase();
  const labelKind = Object.hasOwn(KIND_OF, upper) ? KIND_OF[upper] : undefined;
  const id = rawId.toLowerCase();
  if (version.toUpperCase() !== 'SP1' || labelKind === undefined || !ID.test(id)) {
    return { kind: 'unknown' };
  }
  return { kind: 'label', labelKind, id };
}
