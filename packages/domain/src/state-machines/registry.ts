import type { AnyMachine } from './define-machine';
import { customerLoanMachine } from './machines/customer-loan';
import { dispatchMachine } from './machines/dispatch';
import { documentFilingMachine } from './machines/document-filing';
import { expenseClaimMachine } from './machines/expense-claim';
import { fileUploadMachine } from './machines/file-upload';
import { opportunityMachine } from './machines/opportunity';
import { playbookDirectiveMachine } from './machines/playbook-directive';
import { projectStandardMachine } from './machines/project-standard';
import { projectSuryaGharMachine } from './machines/project-surya-ghar';
import { quoteMachine } from './machines/quote';
import { salesOrderMachine } from './machines/sales-order';
import { subsidyGateMachine } from './machines/subsidy-gate';
import { tallyVoucherMachine } from './machines/tally-voucher';
import { warrantyClaimMachine } from './machines/warranty-claim';

/**
 * Every state machine of BLUEPRINT §19 item 2, and the upload's checks, in the order the
 * specification index lists them.
 */
export const MACHINES: readonly AnyMachine[] = [
  opportunityMachine,
  quoteMachine,
  salesOrderMachine,
  dispatchMachine,
  projectStandardMachine,
  projectSuryaGharMachine,
  subsidyGateMachine,
  customerLoanMachine,
  warrantyClaimMachine,
  documentFilingMachine,
  fileUploadMachine,
  expenseClaimMachine,
  playbookDirectiveMachine,
  tallyVoucherMachine,
];

/** The `<machine>_transition_not_allowed` reasons; each has a sentence in the message catalogue. */
export const MACHINE_REASONS: readonly string[] = MACHINES.map((m) => m.illegalReason);
