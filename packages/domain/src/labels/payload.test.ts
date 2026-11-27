import { newId } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { labelPayload, parseLabelPayload } from './payload';

const id = newId();

describe('a label’s QR payload', () => {
  it('names a serial, a bin and a package by its id, and reads each one back', () => {
    expect(labelPayload('serial', id)).toBe(`SP1:S:${id}`);
    expect(labelPayload('bin', id)).toBe(`SP1:B:${id}`);
    expect(labelPayload('package', id)).toBe(`SP1:P:${id}`);
    for (const labelKind of ['serial', 'bin', 'package'] as const) {
      expect(parseLabelPayload(labelPayload(labelKind, id))).toEqual({
        kind: 'label',
        labelKind,
        id,
      });
    }
  });

  it('writes the id in small letters, and refuses anything that is not one of ours', () => {
    expect(labelPayload('serial', id.toUpperCase())).toBe(`SP1:S:${id}`);
    expect(() => labelPayload('serial', 'ASH26C000001')).toThrow(RangeError);
  });

  it('reads what a handheld scanner types: an Enter or Tab after it, or capitals', () => {
    expect(parseLabelPayload(`SP1:S:${id}\r\n`)).toEqual({
      kind: 'label',
      labelKind: 'serial',
      id,
    });
    expect(parseLabelPayload(`\tSP1:B:${id}\t`)).toEqual({ kind: 'label', labelKind: 'bin', id });
    expect(parseLabelPayload(`SP1:S:${id}`.toUpperCase())).toEqual({
      kind: 'label',
      labelKind: 'serial',
      id,
    });
    expect(parseLabelPayload(`sp1:p:${id}`)).toEqual({ kind: 'label', labelKind: 'package', id });
  });

  it('says a code of ours it cannot read is unknown: another version or letter, or a bad id', () => {
    for (const code of [
      `SP2:S:${id}`,
      `SP0:S:${id}`,
      `SP1:X:${id}`,
      `SP1::${id}`,
      `SP1:SB:${id}`,
      'SP1:S:',
      'SP1:S:12345',
      'SP1:S:ASH26C000001',
      // A version 4 id is not one the BOS makes.
      'SP1:S:0d8c5a3e-1f2b-4c3d-9e8f-7a6b5c4d3e2f',
      `SP1:S:${id}:extra`,
      `SP1:S:${id} `.repeat(2),
      'SP1:',
      'SP1:__proto__:x',
      'SP1:constructor:x',
    ]) {
      expect(parseLabelPayload(code), code).toEqual({ kind: 'unknown' });
    }
  });

  it('says any other code is not ours: a supplier’s barcode, a web address, nothing at all', () => {
    for (const code of [
      '8901234567890',
      'ASH26C000001',
      'https://shaktiprime.com/s/ASH26C000001',
      `S:${id}`,
      `SPX:S:${id}`,
      `ESP1:S:${id}`,
      '',
      '   ',
      `SP1:S:${id}`.padEnd(402, ' x'),
    ]) {
      expect(parseLabelPayload(code), code).toEqual({ kind: 'foreign' });
    }
  });
});
