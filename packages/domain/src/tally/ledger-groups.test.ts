import { describe, expect, it } from 'vitest';
import { isDebtorLedgerParent } from './ledger-groups';

describe('isDebtorLedgerParent', () => {
  it('keeps a ledger under Sundry Debtors, however it is written', () => {
    expect(isDebtorLedgerParent('Sundry Debtors')).toBe(true);
    expect(isDebtorLedgerParent('  sundry   DEBTORS ')).toBe(true);
  });

  it('keeps a ledger under a group the company made, which may sit under Sundry Debtors', () => {
    expect(isDebtorLedgerParent('Dealers North')).toBe(true);
  });

  it("refuses a ledger under any other of Tally's own groups", () => {
    for (const group of [
      'Sundry Creditors',
      'Purchase Accounts',
      'Sales Accounts',
      'Bank Accounts',
      'Cash-in-Hand',
      'Duties & Taxes',
      'Indirect Expenses',
      'Capital Account',
      'loans & advances (asset)',
    ]) {
      expect(isDebtorLedgerParent(group)).toBe(false);
    }
  });
});
