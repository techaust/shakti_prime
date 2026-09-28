import { AUTH_AUDIT_EVENTS } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { isDeniedKey, maskValue, redactAuthEvent, redactForAudit } from './redact';

/** Every field the design's deny list names, by its real column or request-body name. */
const DENIED = {
  password: 'Hunter2hunter2',
  secret: 'JBSWY3DPEHPK3PXP',
  backup_codes: ['aaaa-bbbb'],
  backupCodes: ['cccc-dddd'],
  token: 'session-abc',
  identifier: 'reset-password:abc',
  newPassword: 'Correct horse battery',
  currentPassword: 'Old horse battery',
  bank_json: { ifsc: 'HDFC0000001', account: '123456789012' },
  api_key: 'live-key',
  apiKey: 'live-key',
  refreshTokenHash: 'deadbeef',
};

function keysDeep(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const v of value) keysDeep(v, out);
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysDeep(v, out);
    }
  }
  return out;
}

describe('redactForAudit', () => {
  it('removes every denied field at any depth, in objects and arrays', () => {
    const snapshot = {
      name: 'Shakti Supreme',
      ...DENIED,
      nested: { ...DENIED, lines: [{ ...DENIED, qty: 2 }] },
    };
    const out = redactForAudit({ before: snapshot, after: snapshot });
    const keys = keysDeep(out);
    for (const denied of Object.keys(DENIED)) expect(keys).not.toContain(denied);
    expect(out).toMatchObject({
      before: { name: 'Shakti Supreme', nested: { lines: [{ qty: 2 }] } },
    });
  });

  it('keeps business codes', () => {
    expect(redactForAudit({ code: 'SS', stageCode: 'qualified' })).toEqual({
      code: 'SS',
      stageCode: 'qualified',
    });
  });

  it('keeps only the last four characters of phones and emails, including in lists', () => {
    const out = redactForAudit({
      phone: '+919876543210',
      email: 'owner@shaktisupreme.in',
      phones: [{ e164: '+919812345678', isPrimary: true }],
      whatsappNumber: 919800011122,
    });
    expect(out).toEqual({
      phone: '********3210',
      email: '********e.in',
      phones: [{ e164: '********5678', isPrimary: true }],
      whatsappNumber: '****',
    });
  });

  it('masks a short value completely', () => {
    expect(maskValue('1234')).toBe('****');
    expect(maskValue('')).toBe('****');
    expect(maskValue('12345')).toBe('*2345');
  });

  it('turns dates into ISO text and drops undefined fields', () => {
    const at = new Date('2026-09-27T10:00:00.000Z');
    expect(redactForAudit({ at, gone: undefined, n: null })).toEqual({
      at: '2026-09-27T10:00:00.000Z',
      n: null,
    });
  });

  it('bounds very long text, long lists and deep nesting', () => {
    const long = 'x'.repeat(5000);
    const out = redactForAudit({ long, list: Array.from({ length: 500 }, (_, i) => i) }) as {
      long: string;
      list: number[];
    };
    expect(out.long.length).toBe(2001);
    expect(out.list).toHaveLength(200);
    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 12; i++) deep = { d: deep };
    expect(JSON.stringify(redactForAudit(deep))).toContain('[deep]');
  });

  it('removes Aadhaar, PAN, bank account and IFSC fields at any depth and in any case', () => {
    const identity = {
      aadhaar: '234567890123',
      Aadhaar: '234567890123',
      aadhaar_number: '234567890123',
      uid: '234567890123',
      UID: '234567890123',
      pan: 'ABCDE1234F',
      PAN: 'ABCDE1234F',
      account_number: '50100012345678',
      accountNumber: '50100012345678',
      ACCOUNT_NUMBER: '50100012345678',
      ifsc: 'HDFC0000001',
      IFSC: 'HDFC0000001',
      ifscCode: 'HDFC0000001',
    };
    const snapshot = {
      name: 'Ramesh Patel',
      village: 'Khedbrahma',
      ...identity,
      kyc: { ...identity, documents: [{ kind: 'aadhaar', ...identity }] },
    };
    const out = redactForAudit({ before: snapshot, after: { ...snapshot, village: 'Idar' } });
    const keys = keysDeep(out);
    for (const removed of Object.keys(identity)) expect(keys).not.toContain(removed);
    expect(out).toEqual({
      before: {
        name: 'Ramesh Patel',
        village: 'Khedbrahma',
        kyc: { documents: [{ kind: 'aadhaar' }] },
      },
      after: { name: 'Ramesh Patel', village: 'Idar', kyc: { documents: [{ kind: 'aadhaar' }] } },
    });
  });

  it('matches denied names without regard to case or separators', () => {
    for (const key of ['Password', 'NEW_PASSWORD', 'two-factor-secret', 'sessionToken']) {
      expect(isDeniedKey(key)).toBe(true);
    }
    for (const key of ['Aadhaar', 'uid', 'PAN', 'account-number', 'bankAccountNumber', 'IFSC']) {
      expect(isDeniedKey(key)).toBe(true);
    }
    for (const key of ['code', 'brandName', 'upiId', 'status'])
      expect(isDeniedKey(key)).toBe(false);
  });

  it('removes the spellings and short forms people give identity fields', () => {
    for (const key of [
      'aadhar',
      'Aadhar_Number',
      'aadhaarNo',
      'aadhar-no',
      'PAN_No',
      'accountNo',
    ]) {
      expect(isDeniedKey(key)).toBe(true);
    }
    expect(
      redactForAudit({ name: 'Ramesh Patel', aadhar: '234567890123', panNo: 'ABCDE1234F' }),
    ).toEqual({ name: 'Ramesh Patel' });
  });

  it('scrubs a number typed into a free-text field, in the input and in before and after', () => {
    // A synthetic lead: the person typed an Aadhaar number, phones and an email where text goes.
    const typed = {
      name: 'Ramesh Patel 2345 6789 0123',
      village: 'Idar, 234567890123',
      address: 'Near the tank, call 98765 43210 or ramesh.patel@shakti.test',
      notes: ['Aadhaar 2345-6789-0123 seen', 'alt 098765 43210'],
      remarks: 'call +91 98123 45678',
      // Business values keep their digits: an id, a pin code, a time and an amount.
      id: '01928a3b-1234-7123-8123-123456789012',
      pinCode: '383001',
      at: '2026-09-27T10:00:00.000Z',
      amount: '145000.00',
    };
    const out = redactForAudit({ input: typed, before: typed, after: typed });
    const expected = {
      name: 'Ramesh Patel [number]',
      village: 'Idar, [number]',
      address: 'Near the tank, call ******3210 or [email]',
      notes: ['Aadhaar [number] seen', 'alt *******3210'],
      remarks: 'call ********5678',
      id: '01928a3b-1234-7123-8123-123456789012',
      pinCode: '383001',
      at: '2026-09-27T10:00:00.000Z',
      amount: '145000.00',
    };
    expect(out).toEqual({ input: expected, before: expected, after: expected });
    expect(JSON.stringify(out)).not.toMatch(/2345.?6789.?0123|98765.?43210|98123.?45678/);
  });
});

describe('redactAuthEvent', () => {
  it('records only the allow-listed fields of each event', () => {
    const body = {
      email: 'gm@shaktisupreme.in',
      password: 'Hunter2hunter2',
      code: '123456',
      token: 'reset-token',
      newPassword: 'Correct horse battery',
      method: 'totp',
    };
    for (const event of AUTH_AUDIT_EVENTS) {
      const out = redactAuthEvent(event, body);
      expect(Object.keys(out)).not.toContain('password');
      expect(Object.keys(out)).not.toContain('code');
      expect(Object.keys(out)).not.toContain('token');
      expect(Object.keys(out)).not.toContain('newPassword');
    }
    expect(redactAuthEvent('auth.sign_in', body)).toEqual({ email: '********e.in' });
    expect(redactAuthEvent('auth.two_factor.verify', body)).toEqual({ method: 'totp' });
    expect(redactAuthEvent('auth.sign_out', body)).toEqual({});
  });
});
