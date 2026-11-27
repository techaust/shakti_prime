import { describe, expect, it } from 'vitest';
import { cleanCode, newSerialResolver, scanOnce, type ScanResolve } from './scan-state';

const any: ScanResolve = () => ({ verdict: 'accepted' });

describe('the scan field’s rules', () => {
  it('cleans what a handheld scanner types', () => {
    expect(cleanCode('  SN-0001\r\n')).toBe('SN-0001');
    expect(cleanCode('\t')).toBe('');
  });

  it('takes a new code and keeps the count', async () => {
    const one = await scanOnce([], 'SN-1', any, 2);
    expect(one).toEqual({ codes: ['SN-1'], outcome: { kind: 'taken', code: 'SN-1', known: false, label: undefined } });
    const two = await scanOnce(one.codes, 'SN-2', any, 2);
    expect(two.codes).toEqual(['SN-1', 'SN-2']);
  });

  it('says a repeat at once, in any case, without asking the screen', async () => {
    let asked = 0;
    const counting: ScanResolve = () => {
      asked += 1;
      return { verdict: 'accepted' };
    };
    const out = await scanOnce(['SN-1'], 'sn-1', counting);
    expect(out).toEqual({ codes: ['SN-1'], outcome: { kind: 'repeat', code: 'sn-1' } });
    expect(asked).toBe(0);
  });

  it('refuses more than expected, an unknown code and one of the wrong shape', async () => {
    expect((await scanOnce(['A'], 'B', any, 1)).outcome).toEqual({ kind: 'full', code: 'B' });
    expect((await scanOnce([], 'X', () => ({ verdict: 'unknown' }))).outcome.kind).toBe('unknown');
    expect((await scanOnce([], 'X', () => ({ verdict: 'wrong_pattern' }))).outcome.kind).toBe(
      'wrong_pattern',
    );
    expect((await scanOnce([], '   ', any)).outcome).toEqual({ kind: 'empty' });
  });

  it('takes what the screen names a known code, under the value it gives', async () => {
    const out = await scanOnce([], 'SP1:S:abc', () => ({
      verdict: 'known',
      value: 'PMP-0001',
      label: 'Pump PMP-0001',
    }));
    expect(out).toEqual({
      codes: ['PMP-0001'],
      outcome: { kind: 'taken', code: 'PMP-0001', known: true, label: 'Pump PMP-0001' },
    });
  });

  it('reads a receipt’s new serial against the item’s pattern, whole', async () => {
    const resolve = newSerialResolver('PMP-[0-9]{4}');
    expect(await resolve('PMP-0001')).toEqual({ verdict: 'accepted' });
    expect(await resolve('PMP-00012')).toEqual({ verdict: 'wrong_pattern' });
    expect(await resolve('4006381333931')).toEqual({ verdict: 'wrong_pattern' });
    expect(await newSerialResolver(null)('anything')).toEqual({ verdict: 'accepted' });
  });
});
