import { describe, expect, it } from 'vitest';
import { CheckInRequest } from './attendance';
import { CreateExpenseRequest } from './expenses';
import { FilePresignRequest, MAX_UPLOAD_BYTES } from './files';
import { API_FIXTURES } from './fixtures';

const presign = API_FIXTURES['files.presign'].request as Record<string, unknown>;
const checkIn = API_FIXTURES['attendance.checkIn'].request as Record<string, unknown>;
const expense = API_FIXTURES['expenses.create'].request as {
  lines: Record<string, unknown>[];
} & Record<string, unknown>;

describe('uploads', () => {
  it('refuses a file above the size limit or of another type', () => {
    expect(FilePresignRequest.safeParse({ ...presign, size: MAX_UPLOAD_BYTES + 1 }).success).toBe(
      false,
    );
    expect(FilePresignRequest.safeParse({ ...presign, contentType: 'image/heic' }).success).toBe(
      false,
    );
  });

  it('takes a signature as a PNG only', () => {
    const signature = { ...presign, purpose: 'signature' };
    expect(FilePresignRequest.safeParse(signature).success).toBe(false);
    expect(FilePresignRequest.safeParse({ ...signature, contentType: 'image/png' }).success).toBe(
      true,
    );
  });
});

describe('attendance', () => {
  it('names the site on a site check-in', () => {
    expect(CheckInRequest.safeParse({ ...checkIn, siteId: undefined }).success).toBe(false);
    const office = { ...checkIn, type: 'office_in', siteId: undefined, projectId: undefined };
    expect(CheckInRequest.safeParse(office).success).toBe(true);
  });

  it('needs a position and a selfie', () => {
    expect(CheckInRequest.safeParse({ ...checkIn, geo: undefined }).success).toBe(false);
    expect(CheckInRequest.safeParse({ ...checkIn, selfieFileId: undefined }).success).toBe(false);
  });
});

describe('expense claims', () => {
  it('needs a receipt on every line', () => {
    const line = { ...expense.lines[0], receiptFileIds: [] };
    expect(CreateExpenseRequest.safeParse({ ...expense, lines: [line] }).success).toBe(false);
  });

  it('carries money as a two-decimal string, never a number', () => {
    const line = { ...expense.lines[0], amount: 640 };
    expect(CreateExpenseRequest.safeParse({ ...expense, lines: [line] }).success).toBe(false);
  });

  it('allocates to overhead with a null project', () => {
    expect(CreateExpenseRequest.safeParse({ ...expense, projectId: null }).success).toBe(true);
  });
});
