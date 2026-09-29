import { describe, expect, it } from 'vitest';
import {
  CODE_KEYS,
  isCodeKey,
  jsonLogger,
  memoryLogger,
  redact,
  redactError,
  redactText,
} from './logger';

describe('redaction (AUDIT M10)', () => {
  it('scrubs set-password links, query parameters, credentials and email addresses from text', () => {
    expect(redactText('open http://x/api/auth/reset-password/abcDEF123?callbackURL=%2F')).toBe(
      'open http://x/api/auth/reset-password:[redacted]?callbackURL=%2F',
    );
    expect(
      redactText(
        'Failed query: select * from auth_verifications where identifier = $1\nparams: reset-password:tok,asha@x.in',
      ),
    ).toBe(
      'Failed query: select * from auth_verifications where identifier = $1\nparams: [redacted]',
    );
    expect(redactText('token=abc&x=1 password=hunter2')).toBe(
      'token=[redacted]&x=1 password=[redacted]',
    );
    expect(redactText('no user asha.meena@shakti.in')).toBe('no user [email]');
  });

  it('hides a UPI address, which has no dot after the @', () => {
    expect(redactText('paid to rekha.meena@oksbi today')).toBe('paid to [upi] today');
    expect(redactText('UPI 9876543210@ybl')).toBe('UPI [upi]');
    expect(redactText('mail asha.meena@shakti.in')).toBe('mail [email]');
    expect(redactText('stage New @ 2 pm')).toBe('stage New @ 2 pm');
  });

  it('keeps the last four digits of phone numbers and hides twelve-digit numbers in full', () => {
    expect(redactText('call +919876543210 or 9812345678, not 5123456789')).toBe(
      'call +********3210 or ******5678, not 5123456789',
    );
    for (const aadhaar of ['2345 6789 0123', '2345-6789-0123', '234567890123']) {
      expect(redactText(`Aadhaar ${aadhaar} on file`)).toBe('Aadhaar [number] on file');
    }
    expect(redactText('uid:919876543210.')).toBe('uid:[number].');
    // The digit groups of an id are not personal numbers.
    const ids = [
      '01928a3b-1234-7123-8123-123456789012',
      '01928a3b-4c5d-7e6f-8a9b-987654321098',
      'order 1727430000000',
    ];
    for (const id of ids) expect(redactText(id)).toBe(id);
  });

  it('leaves a UUID whole when its last group reads as a mobile or twelve-digit number', () => {
    for (const id of [
      '01928a3b-4c5d-7e6f-8a9b-919876543210',
      '01928A3B-4C5D-7E6F-8A9B-919876543210',
      '01928a3b-4c5d-7e6f-8a9b-098765432109',
      '01928a3b-4c5d-7e6f-8a9b-234567890123',
    ]) {
      expect(redactText(`lead ${id} moved`)).toBe(`lead ${id} moved`);
    }
  });

  it('still finds a number after a word and a hyphen, which is not a UUID', () => {
    expect(redactText('Mobile-9876543210')).toBe('Mobile-******3210');
    expect(redactText('WA-9876543210')).toBe('WA-******3210');
    expect(redactText('Rekha-9876543210')).toBe('Rekha-******3210');
    expect(redactText('ref 5b-9876543210')).toBe('ref 5b-******3210');
    expect(redactText('card-2345 6789 0123')).toBe('card-[number]');
    expect(redactText('id cafe-234567890123')).toBe('id cafe-[number]');
    // Four groups short of a UUID's head are not one either.
    expect(redactText('4c5d-7e6f-8a9b-919876543210')).toBe('4c5d-7e6f-8a9b-[number]');
  });

  it('keeps an id or code whole only when it looks like one', () => {
    const lead = '01928a3b-4c5d-7e6f-8a9b-919876543210';
    expect(
      redact({
        leadId: lead,
        entity_ids: [1, 2],
        ids: [lead],
        stageCode: 'qualified',
        hsn: '84137010',
        gstin: '24AAAAA0000A1Z5',
        pin: '383001',
        quoteNo: 'SS/2026-27/000123',
        documentNo: 5123456789,
        note: 'eway 234567890123 for 9876543210',
      }),
    ).toEqual({
      leadId: lead,
      entity_ids: [1, 2],
      ids: [lead],
      stageCode: 'qualified',
      hsn: '84137010',
      gstin: '24AAAAA0000A1Z5',
      pin: '383001',
      quoteNo: 'SS/2026-27/000123',
      documentNo: 5123456789,
      note: 'eway [number] for ******3210',
    });
  });

  it('scrubs a value in an id or code field that holds a personal number or free text', () => {
    expect(
      redact({
        pin: '2345 6789 0123',
        existingAccountId: '234567890123',
        code: '9876543210',
        barcode: 919876543210,
        sourceCode: 'Mela at Idar, call 98765 43210',
        leadCode: 'two words',
      }),
    ).toEqual({
      pin: '[number]',
      existingAccountId: '[number]',
      code: '******3210',
      barcode: '[number]',
      sourceCode: 'Mela at Idar, call ******3210',
      leadCode: 'two words',
    });
  });

  it('never takes a personal or free-text field for a code, however its name ends', () => {
    for (const key of [
      'phoneId',
      'mobileNo',
      'emailId',
      'aadhaarId',
      'upiId',
      'whatsappCode',
      'sourceCode',
    ]) {
      expect(isCodeKey(key), key).toBe(false);
    }
    for (const key of [
      'id',
      'leadId',
      'job_id',
      'entityIds',
      'code',
      'sku',
      'barcode',
      'ewayBillNo',
      'ewayBillNumber',
      'serialNo',
      'buyerOrderNo',
    ]) {
      expect(isCodeKey(key), key).toBe(true);
    }
    expect(CODE_KEYS.has('ewaybillno')).toBe(true);
    expect(isCodeKey('remarksNo')).toBe(false);
    // `upi` marks a personal field only as a whole part of the name.
    for (const key of ['upiId', 'upi_ref', 'UPI', 'customerUpiId']) {
      expect(isCodeKey(key), key).toBe(false);
    }
    for (const key of ['groupId', 'pickupId', 'pickup_code']) {
      expect(isCodeKey(key), key).toBe(true);
    }
  });

  it('hides a number of ten digits or more, unless its field holds a time or an amount', () => {
    expect(
      redact({
        village: 234567890123,
        contact: 9876543210,
        big: 98765432101n,
        count: 999_999_999,
        durationMs: 12,
        createdAt: 1727430000000,
        expires_at: 1727430000,
        exp: 1727430000,
        iat: 1727429000,
        expires: 1727430000,
        amountPaise: 1450000000000,
        lineTotal: 1450000000,
        amount: 12345678901,
      }),
    ).toEqual({
      village: '[number]',
      contact: '[number]',
      big: '[number]',
      count: 999_999_999,
      durationMs: 12,
      createdAt: 1727430000000,
      expires_at: 1727430000,
      exp: 1727430000,
      iat: 1727429000,
      expires: 1727430000,
      amountPaise: 1450000000000,
      lineTotal: 1450000000,
      amount: 12345678901,
    });
  });

  it('keeps the last four digits of a mobile number written spaced or after 0, 91 or +91', () => {
    const written = {
      '98765 43210': '******3210',
      '98765-43210': '******3210',
      '098765 43210': '*******3210',
      '09876543210': '*******3210',
      '91 98765 43210': '********3210',
      '91-9876543210': '********3210',
      '+91 98765 43210': '********3210',
      '+91-98765-43210': '********3210',
    };
    for (const [phone, masked] of Object.entries(written)) {
      expect(redactText(`call ${phone} today`)).toBe(`call ${masked} today`);
    }
    // Not a mobile number: a landline-looking run, and a number inside a longer one.
    for (const text of ['call 5123456789', 'ref 1098765 43210', 'id 98765 432109']) {
      expect(redactText(text)).toBe(text);
    }
  });

  it('drops identity-number fields whatever their case or separators', () => {
    expect(
      redact({
        requestId: 'r-1',
        aadhaar: '234567890123',
        Aadhaar_Number: '234567890123',
        uid: '234567890123',
        PAN: 'ABCDE1234F',
        account_number: '50100012345678',
        accountNumber: '50100012345678',
        IFSC: 'HDFC0000001',
        nested: {
          ifsc_code: 'HDFC0000001',
          bankAccountNumber: '50100012345678',
          aadhar: '234567890123',
          aadhar_number: '234567890123',
          pan_no: 'ABCDE1234F',
          accountNo: '50100012345678',
        },
      }),
    ).toEqual({
      requestId: 'r-1',
      aadhaar: '[redacted]',
      Aadhaar_Number: '[redacted]',
      uid: '[redacted]',
      PAN: '[redacted]',
      account_number: '[redacted]',
      accountNumber: '[redacted]',
      IFSC: '[redacted]',
      nested: {
        ifsc_code: '[redacted]',
        bankAccountNumber: '[redacted]',
        aadhar: '[redacted]',
        aadhar_number: '[redacted]',
        pan_no: '[redacted]',
        accountNo: '[redacted]',
      },
    });
  });

  it('keeps the codes and the cause chain of an error, and drops bound values', () => {
    const cause = Object.assign(new Error('duplicate key value'), {
      code: '23505',
      constraint_name: 'users_email_unique',
      parameters: ['asha@shakti.in'],
    });
    const error = Object.assign(
      new Error('Failed query: insert into users\nparams: asha@shakti.in'),
      {
        query: 'insert into users',
        params: ['asha@shakti.in'],
        cause,
      },
    );
    expect(redactError(error)).toEqual({
      name: 'Error',
      message: 'Failed query: insert into users\nparams: [redacted]',
      cause: {
        name: 'Error',
        message: 'duplicate key value',
        code: '23505',
        constraint_name: 'users_email_unique',
      },
    });
  });
});

describe('jsonLogger', () => {
  it('writes one JSON line with level, event, time and redacted fields', () => {
    const lines: string[] = [];
    jsonLogger((_level, line) => lines.push(line)).log('error', 'auth.failed', {
      requestId: 'r-1',
      token: 'abc',
      error: new Error('link reset-password/xyz failed'),
    });
    const entry = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 'error',
      event: 'auth.failed',
      requestId: 'r-1',
      token: '[redacted]',
      error: { message: 'link reset-password:[redacted] failed' },
    });
    expect(typeof entry.time).toBe('string');
  });

  it('writes a bigint as text rather than failing', () => {
    const lines: string[] = [];
    const log = jsonLogger((_level, line) => lines.push(line));
    expect(() => {
      log.log('info', 'invoice.totalled', { amountPaise: 1450n, lines: 2n, contact: 98765432101n });
    }).not.toThrow();
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      amountPaise: '1450',
      lines: '2',
      contact: '[number]',
    });
  });

  it('the memory logger keeps redacted entries', () => {
    const log = memoryLogger();
    log.log('warn', 'cache.miss', { cookie: 'shakti.session_token=abc' });
    expect(log.entries).toEqual([
      { level: 'warn', event: 'cache.miss', fields: { cookie: '[redacted]' } },
    ]);
  });
});
