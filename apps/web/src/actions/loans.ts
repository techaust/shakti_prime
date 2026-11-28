'use server';

import {
  AccountLoansInput,
  CreateCustomerLoanInput,
  CreateLenderInput,
  DisburseCustomerLoanInput,
  ListLendersInput,
  OrderLoansInput,
  RejectCustomerLoanInput,
  SanctionCustomerLoanInput,
  UpdateLenderInput,
  WaiveLoanGatesInput,
  type AccountLoanRowDto,
  type CustomerLoanDto,
  type LenderDto,
  type OrderLoansDto,
} from '@shakti/contracts';
import {
  createCustomerLoan as createCustomerLoanCommand,
  createLender as createLenderCommand,
  disburseCustomerLoan as disburseCustomerLoanCommand,
  executeCommand,
  executeQuery,
  getOrderLoans as getOrderLoansQuery,
  listAccountLoans as listAccountLoansQuery,
  listLenders as listLendersQuery,
  rejectCustomerLoan as rejectCustomerLoanCommand,
  sanctionCustomerLoan as sanctionCustomerLoanCommand,
  updateLender as updateLenderCommand,
  waiveLoanGates as waiveLoanGatesCommand,
  type AnyCommand,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn, type Schema } from './support';

// J2 customer loans (docs/03-roadmap-appendix/phase4.md §6.2): the order's Loan tab, Account 360's
// loans and Settings › Lenders, each in a request narrowed to the record's company.

async function companyCommand<T>(
  action: string,
  schema: Schema<{ entityId: number }>,
  command: AnyCommand,
  rawInput: unknown,
  idempotencyKey: unknown,
): Promise<ActionResult<T>> {
  return toResult(action, async () => {
    const principal = await signedIn();
    const input = parseInput(schema, rawInput);
    const meta = await requestMeta();
    return (await executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      command,
      input,
      commandOptions(meta, idempotencyKey),
    )) as T;
  });
}

/** The order's Loan tab: its loans, the gate answer and the lenders to choose from. */
export async function getOrderLoans(rawInput: unknown): Promise<ActionResult<OrderLoansDto>> {
  return toResult('getOrderLoans', async () => {
    const principal = await signedIn();
    const input = parseInput(OrderLoansInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => getOrderLoansQuery(context, input),
      { name: 'getOrderLoans' },
    );
  });
}

/** Account 360's loans in one company, newest first. */
export async function listAccountLoans(
  rawInput: unknown,
): Promise<ActionResult<AccountLoanRowDto[]>> {
  return toResult('listAccountLoans', async () => {
    const principal = await signedIn();
    const input = parseInput(AccountLoansInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => listAccountLoansQuery(context, input),
      { name: 'listAccountLoans' },
    );
  });
}

/** Settings › Lenders: one company's lenders by name. */
export async function listLenders(rawInput: unknown): Promise<ActionResult<LenderDto[]>> {
  return toResult('listLenders', async () => {
    const principal = await signedIn();
    const input = parseInput(ListLendersInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => listLendersQuery(context, input),
      { name: 'listLenders' },
    );
  });
}

/** Records a loan applied for on an order. */
export async function createLoan(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<CustomerLoanDto>> {
  return companyCommand(
    'createLoan',
    CreateCustomerLoanInput,
    createCustomerLoanCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Records the lender's sanction and its amount. */
export async function sanctionLoan(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<CustomerLoanDto>> {
  return companyCommand(
    'sanctionLoan',
    SanctionCustomerLoanInput,
    sanctionCustomerLoanCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Records that the lender paid the loan out. */
export async function disburseLoan(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<CustomerLoanDto>> {
  return companyCommand(
    'disburseLoan',
    DisburseCustomerLoanInput,
    disburseCustomerLoanCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Records that the lender turned the loan down, with their reason. */
export async function rejectLoan(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<CustomerLoanDto>> {
  return companyCommand(
    'rejectLoan',
    RejectCustomerLoanInput,
    rejectCustomerLoanCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Records that the order no longer waits for a loan its lender turned down, with the reason. */
export async function waiveLoanGates(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<CustomerLoanDto>> {
  return companyCommand(
    'waiveLoanGates',
    WaiveLoanGatesInput,
    waiveLoanGatesCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Adds a lender to a company's list. */
export async function createLender(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<LenderDto>> {
  return companyCommand(
    'createLender',
    CreateLenderInput,
    createLenderCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Renames a lender, or switches it off or on. */
export async function updateLender(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<LenderDto>> {
  return companyCommand(
    'updateLender',
    UpdateLenderInput,
    updateLenderCommand,
    rawInput,
    idempotencyKey,
  );
}
