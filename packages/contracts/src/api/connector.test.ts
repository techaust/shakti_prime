import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CONNECTOR_CLOCK_SKEW_SECONDS,
  ConnectorBatchRequest,
  ConnectorHeaders,
  connectorSigningString,
  isConnectorTimestampFresh,
  TallyVoucher,
} from './connector';
import { API_FIXTURES, IDS, tallyGuid } from './fixtures';

const batch = API_FIXTURES['connector.batches'].request as {
  vouchers: Record<string, unknown>[];
} & Record<string, unknown>;

describe('connector signing (docs/API.md §2)', () => {
  const body = JSON.stringify(batch);
  const timestamp = '1790500000';

  function sign(key: string, method: string, path: string, raw: string): string {
    const text = connectorSigningString({
      method,
      pathWithQuery: path,
      timestamp,
      bodySha256Hex: createHash('sha256').update(raw).digest('hex'),
    });
    return createHmac('sha256', key).update(text).digest('hex');
  }

  it('signs method, path, time and the body hash, one per line', () => {
    expect(
      connectorSigningString({
        method: 'post',
        pathWithQuery: '/api/v1/connector/tally/batches',
        timestamp,
        bodySha256Hex: 'AB'.repeat(32),
      }),
    ).toBe(`POST\n/api/v1/connector/tally/batches\n${timestamp}\n${'ab'.repeat(32)}`);
  });

  it('gives a header set the route accepts, and a different signature for a changed body', () => {
    const key = 'tally connector key for the contract test';
    const signature = sign(key, 'POST', '/api/v1/connector/tally/batches', body);
    const headers = {
      'x-connector-id': IDS.connector,
      'x-timestamp': timestamp,
      'x-signature': signature,
    };
    expect(ConnectorHeaders.parse(headers)).toEqual(headers);
    expect(sign(key, 'POST', '/api/v1/connector/tally/batches', `${body} `)).not.toBe(signature);
    expect(sign(key, 'GET', '/api/v1/connector/tally/batches', body)).not.toBe(signature);
  });

  it('accepts five minutes of clock difference either way and no more', () => {
    const now = Number(timestamp);
    expect(isConnectorTimestampFresh(timestamp, now + CONNECTOR_CLOCK_SKEW_SECONDS)).toBe(true);
    expect(isConnectorTimestampFresh(timestamp, now - CONNECTOR_CLOCK_SKEW_SECONDS)).toBe(true);
    expect(isConnectorTimestampFresh(timestamp, now + CONNECTOR_CLOCK_SKEW_SECONDS + 1)).toBe(
      false,
    );
    expect(isConnectorTimestampFresh('17905e0000', now)).toBe(false);
  });
});

describe('connector batches', () => {
  it('refuses a row outside the batch range', () => {
    const late = { ...batch.vouchers[0], alterId: 48221 };
    expect(ConnectorBatchRequest.safeParse({ ...batch, vouchers: [late] }).success).toBe(false);
    const early = { ...batch.vouchers[0], alterId: 48200 };
    expect(ConnectorBatchRequest.safeParse({ ...batch, vouchers: [early] }).success).toBe(false);
  });

  it('refuses the same voucher twice', () => {
    const [first] = batch.vouchers;
    expect(ConnectorBatchRequest.safeParse({ ...batch, vouchers: [first, first] }).success).toBe(
      false,
    );
  });

  it('refuses a voucher type the BOS does not read and a malformed GUID', () => {
    const [voucher] = batch.vouchers;
    expect(TallyVoucher.safeParse({ ...voucher, type: 'journal' }).success).toBe(false);
    expect(TallyVoucher.safeParse({ ...voucher, guid: 'not-a-guid' }).success).toBe(false);
    expect(TallyVoucher.safeParse({ ...voucher, guid: tallyGuid(1) }).success).toBe(true);
  });

  it('carries amounts as strings with two decimals', () => {
    const [voucher] = batch.vouchers;
    expect(TallyVoucher.safeParse({ ...voucher, amount: 125000 }).success).toBe(false);
  });
});
