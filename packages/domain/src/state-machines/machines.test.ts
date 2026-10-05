import { newId, PERMISSION_KEYS } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import type { Requirement } from '../command/define-command';
import { findTransition, transition, type Actor, type AnyMachine } from './define-machine';
import { customerLoanMachine } from './machines/customer-loan';
import { dispatchMachine } from './machines/dispatch';
import { documentFilingMachine } from './machines/document-filing';
import { expenseClaimMachine } from './machines/expense-claim';
import { agentActionMachine } from './machines/agent-action';
import { fileUploadMachine } from './machines/file-upload';
import { inboxItemMachine } from './machines/inbox-item';
import { opportunityMachine } from './machines/opportunity';
import { playbookDirectiveMachine } from './machines/playbook-directive';
import { projectStandardMachine } from './machines/project-standard';
import { projectSuryaGharMachine } from './machines/project-surya-ghar';
import { quoteMachine } from './machines/quote';
import { salesOrderMachine } from './machines/sales-order';
import { subsidyGateMachine } from './machines/subsidy-gate';
import { tallyVoucherMachine } from './machines/tally-voucher';
import { taskMachine } from './machines/task';
import { warrantyClaimMachine } from './machines/warranty-claim';
import { MACHINE_REASONS, MACHINES } from './registry';
import { everything, holding, platform } from './test-support';

const NOW = new Date('2026-06-15T06:30:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PIPELINE = newId();

type Facts = Record<string, unknown>;

interface Setup {
  record?: Facts;
  params?: Facts;
  now?: Date;
}

/**
 * For each machine: facts under which every guard passes, and per-event changes where two events
 * need opposite facts (a quote's acceptance and its expiry).
 */
interface Fixture {
  machine: AnyMachine;
  record: Facts;
  params: Facts;
  events?: Record<string, Setup>;
}

const FIXTURES: Fixture[] = [
  { machine: agentActionMachine, record: {}, params: {} },
  { machine: inboxItemMachine, record: {}, params: {} },
  { machine: taskMachine, record: {}, params: { dueAt: new Date(NOW.getTime() + HOUR) } },
  {
    machine: opportunityMachine,
    record: {
      pipelineId: PIPELINE,
      exitRequiredFields: ['village'],
      fields: { village: 'Nashik' },
      lockedUntil: null,
      stateChangedAt: new Date(NOW.getTime() - DAY),
      hasAcceptedQuoteOrConfirmedOrder: true,
    },
    params: { targetStage: { id: newId(), pipelineId: PIPELINE }, reason: 'not now' },
  },
  {
    machine: quoteMachine,
    record: {
      segment: 'farmer_pumps',
      priceListId: newId(),
      sizingComplete: true,
      pumpCurveInBounds: true,
      dcrRuleMet: true,
      pdfFileId: newId(),
      validUntil: new Date(NOW.getTime() + DAY),
    },
    params: { acceptedVia: 'whatsapp_reply', reason: 'customer asked' },
    events: { expire: { record: { validUntil: new Date(NOW.getTime() - 1) } } },
  },
  {
    machine: salesOrderMachine,
    record: {
      accountType: 'dealer',
      fromAcceptedQuote: true,
      credit: {
        accountType: 'dealer',
        creditLimit: '100000.00',
        creditDays: 30,
        outstanding: '10000.00',
        confirmedUnpaid: '0.00',
        orderValue: '5000.00',
        oldestOverdueDays: 5,
        oldestOverdueInvoiceNo: 'SS/SI/2026-27/0001',
      },
      creditRelease: null,
      hasActiveDispatch: false,
      voucherLinked: true,
      balanceDue: '0.00',
    },
    params: { reason: 'released for the harvest season' },
  },
  {
    machine: dispatchMachine,
    record: {
      consignmentValue: '75000.00',
      ewayBillNo: '281234567890',
      ewayValidUntil: new Date(NOW.getTime() + DAY),
      vehicleNo: 'MH15AB1234',
      loanGateRequired: true,
      loanGateMet: true,
      dcrSerialsRequired: true,
      dcrSerialsValidated: true,
      arrivalPhotoFileId: newId(),
    },
    params: { reason: 'customer postponed' },
  },
  {
    machine: projectStandardMachine,
    record: {
      milestones: [
        { code: 'survey', done: true, documentsComplete: true },
        { code: 'dispatch', done: false, documentsComplete: true },
      ],
    },
    params: { milestoneCode: 'dispatch', reason: 'waiting for the site' },
    events: {
      complete: {
        record: { milestones: [{ code: 'survey', done: true, documentsComplete: true }] },
      },
    },
  },
  {
    machine: projectSuryaGharMachine,
    record: {
      loadEnhancementRequired: false,
      documentsComplete: true,
      gateApproved: true,
      sanctionedLoadKw: '3.00',
      dcrSerialsValidated: true,
      subsidyCredited: true,
    },
    params: { reason: 'customer withdrew' },
    events: { 'load.enhance': { record: { loadEnhancementRequired: true } } },
  },
  {
    machine: subsidyGateMachine,
    record: { missingDocuments: [] },
    params: { reason: 'blurred electricity bill' },
  },
  {
    machine: customerLoanMachine,
    record: {},
    params: { amount: '150000.00', reason: 'income proof refused' },
  },
  {
    machine: warrantyClaimMachine,
    record: {
      warrantyUntil: '2027-06-30',
      replacementSerialId: newId(),
      supplierRmaRef: 'RMA-1182',
      supplierSettled: true,
    },
    params: { serialId: newId(), reason: 'physical damage' },
  },
  {
    machine: documentFilingMachine,
    record: {
      scanClean: true,
      senderAccountId: 'acct-1',
      targetAccountId: 'acct-1',
      needsReview: false,
    },
    params: { reason: 'unreadable' },
  },
  {
    machine: fileUploadMachine,
    record: { storedMatches: true },
    params: { reason: 'file_infected' },
  },
  {
    machine: expenseClaimMachine,
    record: {
      claimantId: newId(),
      managerApproverId: newId(),
      lineCount: 2,
      receiptsComplete: true,
    },
    params: { reason: 'not a business expense' },
  },
  {
    machine: playbookDirectiveMachine,
    record: { conflictsWith: [] },
    params: { reason: 'superseded by the new pricing rule' },
  },
  {
    machine: tallyVoucherMachine,
    record: { matchFound: true, inSnapshot: false },
    params: { target: { refType: 'sales_order', refId: newId() } },
    events: { queue: { record: { matchFound: false } } },
  },
];

type AnyTransition = AnyMachine['transitions'][number];

function fixtureOf(name: string): Fixture {
  const fixture = FIXTURES.find((f) => f.machine.name === name);
  if (!fixture) throw new Error(`no fixture ${name}`);
  return fixture;
}

/** For a transition whose permission its input names, a permission the command resolved. */
function requirementFor(t: AnyTransition): { requirement?: Requirement } {
  return t.permissionByInput === undefined
    ? {}
    : { requirement: { permission: 'sales.quote.send', minScope: 'own' } };
}

/** Someone the transition lets through: every permission for a person, else the platform. */
function allowedActor(t: AnyTransition): Actor {
  return t.permission === null && t.permissionByInput === undefined ? platform : everything();
}

function setup(fixture: Fixture, state: string | null, event: string) {
  const extra = fixture.events?.[event];
  return {
    record: { ...fixture.record, ...extra?.record, state },
    params: { ...fixture.params, ...extra?.params },
    now: extra?.now ?? NOW,
  };
}

describe('the registry', () => {
  it('has a fixture for every machine and a reason for each', () => {
    expect(FIXTURES.map((f) => f.machine.name).sort()).toEqual(MACHINES.map((m) => m.name).sort());
    expect(MACHINE_REASONS).toEqual(MACHINES.map((m) => `${m.name}_transition_not_allowed`));
    expect(new Set(MACHINES.map((m) => m.name)).size).toBe(MACHINES.length);
  });

  it('names only catalogue permissions and never a cost permission', () => {
    for (const machine of MACHINES) {
      for (const t of machine.transitions) {
        if (t.permission !== null) expect(PERMISSION_KEYS).toContain(t.permission);
        expect(['finance.cost.read', 'procurement.rate.read']).not.toContain(t.permission);
      }
    }
  });
});

describe.each(FIXTURES)('$machine.name', (fixture) => {
  const { machine } = fixture;
  const states: (string | null)[] = [null, ...machine.states];
  const pairs = states.flatMap((state) => machine.events.map((event) => ({ state, event })));
  const legal = pairs.flatMap(({ state, event }) => {
    const t = findTransition(machine, state, event);
    return t ? [{ state, event, t }] : [];
  });
  const illegal = pairs.filter(({ state, event }) => !findTransition(machine, state, event));

  it.each(legal)('legal: $event from $state', ({ state, event, t }) => {
    const { record, params, now } = setup(fixture, state, event);
    const result = transition(machine, record, event, {
      actor: allowedActor(t),
      now,
      params,
      ...requirementFor(t),
    });
    expect(result).toEqual({ from: state, to: t.to, event, effects: t.effects ?? [] });
  });

  it.each(illegal)('illegal: $event from $state', ({ state, event }) => {
    const { record, params, now } = setup(fixture, state, event);
    expect(() => transition(machine, record, event, { actor: everything(), now, params })).toThrow(
      expect.objectContaining({
        code: 'conflict',
        details: expect.objectContaining({ reason: machine.illegalReason }) as unknown,
      }),
    );
  });

  const firstFroms = machine.transitions.map((t) => ({
    t,
    state: t.from === 'new' ? null : (t.from[0] ?? null),
    label: t.event,
  }));

  it.each(firstFroms.filter(({ t }) => t.permission !== null))(
    'denied without the permission: $label',
    ({ t, state }) => {
      const { record, params, now } = setup(fixture, state, t.event);
      expect(() =>
        transition(machine, record, t.event, { actor: holding([]), now, params }),
      ).toThrow(expect.objectContaining({ code: 'forbidden' }));
    },
  );

  it.each(firstFroms.filter(({ t }) => t.system !== true))(
    'refused to the platform: $label',
    ({ t, state }) => {
      const { record, params, now } = setup(fixture, state, t.event);
      expect(() => transition(machine, record, t.event, { actor: platform, now, params })).toThrow(
        expect.objectContaining({ code: 'forbidden' }),
      );
    },
  );

  it.each(firstFroms.filter(({ t }) => t.permission === null && !t.permissionByInput))(
    'refused to a person: $label',
    ({ t, state }) => {
      const { record, params, now } = setup(fixture, state, t.event);
      expect(() =>
        transition(machine, record, t.event, { actor: everything(), now, params }),
      ).toThrow(expect.objectContaining({ code: 'forbidden' }));
    },
  );
});

interface GuardCase {
  fixture: string;
  from: string | null;
  event: string;
  record?: Facts;
  params?: Facts;
  now?: Date;
  actor?: Actor;
  code: string;
  reason: string;
}

const GUARDS: GuardCase[] = [
  // File upload
  {
    fixture: 'file_upload',
    from: 'pending',
    event: 'complete',
    record: { storedMatches: false },
    code: 'conflict',
    reason: 'file_upload_mismatch',
  },
  {
    fixture: 'file_upload',
    from: 'pending',
    event: 'complete',
    record: { storedMatches: null },
    code: 'conflict',
    reason: 'file_upload_mismatch',
  },
  {
    fixture: 'file_upload',
    from: 'scanned',
    event: 'reject',
    params: { reason: ' ' },
    code: 'validation_failed',
    reason: 'transition_reason_missing',
  },
  // Opportunity
  {
    fixture: 'opportunity',
    from: 'open',
    event: 'stage.move',
    params: { targetStage: null },
    code: 'validation_failed',
    reason: 'stage_missing',
  },
  {
    fixture: 'opportunity',
    from: 'open',
    event: 'stage.move',
    params: { targetStage: { id: newId(), pipelineId: newId() } },
    code: 'validation_failed',
    reason: 'stage_other_pipeline',
  },
  {
    fixture: 'opportunity',
    from: 'open',
    event: 'stage.move',
    record: { fields: { village: '  ' } },
    code: 'validation_failed',
    reason: 'stage_fields_missing',
  },
  {
    fixture: 'opportunity',
    from: 'open',
    event: 'assign',
    record: { lockedUntil: new Date(NOW.getTime() + HOUR) },
    actor: holding([{ key: 'crm.lead.assign', scope: 'own' }]),
    code: 'conflict',
    reason: 'opportunity_locked',
  },
  {
    fixture: 'opportunity',
    from: 'open',
    event: 'nurture',
    params: { reason: '' },
    code: 'validation_failed',
    reason: 'transition_reason_missing',
  },
  {
    fixture: 'opportunity',
    from: 'lost',
    event: 'reopen',
    record: { stateChangedAt: new Date(NOW.getTime() - 31 * DAY) },
    code: 'conflict',
    reason: 'reopen_window_passed',
  },
  {
    fixture: 'opportunity',
    from: 'open',
    event: 'win',
    record: { hasAcceptedQuoteOrConfirmedOrder: false },
    code: 'conflict',
    reason: 'win_needs_order',
  },
  {
    fixture: 'opportunity',
    from: 'nurture',
    event: 'lose',
    params: { reason: null },
    code: 'validation_failed',
    reason: 'transition_reason_missing',
  },
  // Quote
  {
    fixture: 'quote',
    from: null,
    event: 'create',
    record: { priceListId: null },
    code: 'validation_failed',
    reason: 'price_list_missing',
  },
  {
    fixture: 'quote',
    from: null,
    event: 'create',
    record: { segment: 'residential_rooftop', sizingComplete: false },
    code: 'validation_failed',
    reason: 'sizing_incomplete',
  },
  {
    fixture: 'quote',
    from: null,
    event: 'create',
    record: { pumpCurveInBounds: false },
    code: 'validation_failed',
    reason: 'pump_curve_out_of_bounds',
  },
  {
    fixture: 'quote',
    from: null,
    event: 'create',
    record: { dcrRuleMet: false },
    code: 'validation_failed',
    reason: 'dcr_rule_failed',
  },
  {
    fixture: 'quote',
    from: 'draft',
    event: 'send',
    record: { pdfFileId: null },
    code: 'conflict',
    reason: 'quote_pdf_missing',
  },
  {
    fixture: 'quote',
    from: 'sent',
    event: 'accept',
    record: { validUntil: new Date(NOW.getTime() - 1) },
    code: 'conflict',
    reason: 'quote_expired',
  },
  {
    fixture: 'quote',
    from: 'sent',
    event: 'accept',
    params: { acceptedVia: null },
    code: 'validation_failed',
    reason: 'quote_acceptance_missing',
  },
  {
    fixture: 'quote',
    from: 'sent',
    event: 'expire',
    record: { validUntil: NOW },
    actor: platform,
    code: 'conflict',
    reason: 'quote_still_valid',
  },
  // Sales order
  {
    fixture: 'sales_order',
    from: null,
    event: 'create',
    record: { accountType: 'household', fromAcceptedQuote: false },
    code: 'conflict',
    reason: 'order_needs_accepted_quote',
  },
  {
    fixture: 'sales_order',
    from: 'draft',
    event: 'credit.release',
    params: { reason: ' ' },
    code: 'validation_failed',
    reason: 'transition_reason_missing',
  },
  {
    fixture: 'sales_order',
    from: 'dispatched',
    event: 'invoice',
    record: { voucherLinked: false },
    actor: platform,
    code: 'conflict',
    reason: 'order_voucher_missing',
  },
  {
    fixture: 'sales_order',
    from: 'invoiced',
    event: 'close',
    record: { balanceDue: '0.01' },
    code: 'conflict',
    reason: 'order_payments_outstanding',
  },
  {
    fixture: 'sales_order',
    from: 'confirmed',
    event: 'cancel',
    record: { hasActiveDispatch: true },
    code: 'conflict',
    reason: 'order_already_dispatched',
  },
  // Dispatch
  {
    fixture: 'dispatch',
    from: 'ready',
    event: 'depart',
    record: { ewayBillNo: null },
    code: 'conflict',
    reason: 'eway_bill_missing',
  },
  {
    fixture: 'dispatch',
    from: 'ready',
    event: 'depart',
    record: { vehicleNo: ' ' },
    code: 'conflict',
    reason: 'eway_bill_missing',
  },
  {
    fixture: 'dispatch',
    from: 'ready',
    event: 'depart',
    record: { ewayValidUntil: NOW },
    code: 'conflict',
    reason: 'eway_bill_expired',
  },
  {
    fixture: 'dispatch',
    from: 'ready',
    event: 'depart',
    record: { loanGateMet: false },
    code: 'conflict',
    reason: 'loan_gate_pending',
  },
  {
    fixture: 'dispatch',
    from: 'ready',
    event: 'depart',
    record: { dcrSerialsValidated: false },
    code: 'conflict',
    reason: 'dcr_serials_unvalidated',
  },
  {
    fixture: 'dispatch',
    from: 'in_transit',
    event: 'deliver',
    record: { arrivalPhotoFileId: null },
    code: 'validation_failed',
    reason: 'arrival_photo_missing',
  },
  // Standard project
  {
    fixture: 'project_standard',
    from: 'active',
    event: 'milestone.complete',
    params: { milestoneCode: 'survey' },
    code: 'conflict',
    reason: 'milestone_out_of_order',
  },
  {
    fixture: 'project_standard',
    from: 'active',
    event: 'milestone.complete',
    record: { milestones: [{ code: 'dispatch', done: false, documentsComplete: false }] },
    code: 'validation_failed',
    reason: 'documents_missing',
  },
  {
    fixture: 'project_standard',
    from: 'active',
    event: 'complete',
    record: {
      milestones: [
        { code: 'survey', done: true, documentsComplete: true },
        { code: 'dispatch', done: false, documentsComplete: true },
      ],
    },
    code: 'conflict',
    reason: 'milestones_open',
  },
  // PM Surya Ghar
  {
    fixture: 'project_surya_ghar',
    from: 'survey',
    event: 'load.enhance',
    record: { loadEnhancementRequired: false },
    code: 'conflict',
    reason: 'load_enhancement_not_needed',
  },
  {
    fixture: 'project_surya_ghar',
    from: 'survey',
    event: 'survey.complete',
    record: { loadEnhancementRequired: true },
    code: 'conflict',
    reason: 'load_enhancement_required',
  },
  {
    fixture: 'project_surya_ghar',
    from: 'agreement',
    event: 'agreement.signed',
    record: { documentsComplete: false },
    code: 'validation_failed',
    reason: 'documents_missing',
  },
  {
    fixture: 'project_surya_ghar',
    from: 'portal_registration',
    event: 'registration.approved',
    record: { gateApproved: false },
    code: 'conflict',
    reason: 'subsidy_gate_open',
  },
  {
    fixture: 'project_surya_ghar',
    from: 'feasibility',
    event: 'feasibility.approved',
    record: { sanctionedLoadKw: null },
    code: 'validation_failed',
    reason: 'sanctioned_load_missing',
  },
  {
    fixture: 'project_surya_ghar',
    from: 'material',
    event: 'material.delivered',
    record: { dcrSerialsValidated: false },
    code: 'conflict',
    reason: 'dcr_serials_unvalidated',
  },
  {
    fixture: 'project_surya_ghar',
    from: 'dbt_tracking',
    event: 'subsidy.credited',
    record: { subsidyCredited: false },
    code: 'conflict',
    reason: 'subsidy_not_credited',
  },
  // Subsidy gate
  {
    fixture: 'subsidy_gate',
    from: 'pending',
    event: 'submit',
    record: { missingDocuments: ['electricity_bill'] },
    code: 'validation_failed',
    reason: 'documents_missing',
  },
  {
    fixture: 'subsidy_gate',
    from: 'rejected',
    event: 'resubmit',
    record: { missingDocuments: ['site_photo'] },
    code: 'validation_failed',
    reason: 'documents_missing',
  },
  {
    fixture: 'subsidy_gate',
    from: 'submitted',
    event: 'reject',
    params: { reason: null },
    code: 'validation_failed',
    reason: 'transition_reason_missing',
  },
  // Customer loan
  {
    fixture: 'customer_loan',
    from: 'applied',
    event: 'sanction',
    params: { amount: null },
    code: 'validation_failed',
    reason: 'loan_amount_missing',
  },
  {
    fixture: 'customer_loan',
    from: 'sanctioned',
    event: 'disburse',
    params: { amount: '0.00' },
    code: 'validation_failed',
    reason: 'loan_amount_missing',
  },
  // Warranty claim
  {
    fixture: 'warranty_claim',
    from: 'raised',
    event: 'serial.identify',
    params: { serialId: null },
    code: 'validation_failed',
    reason: 'warranty_serial_missing',
  },
  {
    fixture: 'warranty_claim',
    from: 'raised',
    event: 'serial.identify',
    record: { warrantyUntil: '2026-06-14' },
    code: 'conflict',
    reason: 'warranty_expired',
  },
  {
    fixture: 'warranty_claim',
    from: 'raised',
    event: 'serial.identify',
    record: { warrantyUntil: null },
    code: 'conflict',
    reason: 'warranty_expired',
  },
  {
    fixture: 'warranty_claim',
    from: 'serial_identified',
    event: 'replace',
    record: { replacementSerialId: null },
    code: 'validation_failed',
    reason: 'replacement_serial_missing',
  },
  {
    fixture: 'warranty_claim',
    from: 'replacement_issued',
    event: 'rma.raise',
    record: { supplierRmaRef: null },
    code: 'validation_failed',
    reason: 'rma_ref_missing',
  },
  {
    fixture: 'warranty_claim',
    from: 'rma_raised',
    event: 'settle',
    record: { supplierSettled: false },
    code: 'conflict',
    reason: 'supplier_settlement_missing',
  },
  // Document filing
  {
    fixture: 'document_filing',
    from: 'scanning',
    event: 'mask',
    record: { scanClean: false },
    actor: platform,
    code: 'conflict',
    reason: 'file_not_clean',
  },
  {
    fixture: 'document_filing',
    from: 'scanning',
    event: 'mask',
    record: { scanClean: null },
    actor: platform,
    code: 'conflict',
    reason: 'file_not_clean',
  },
  {
    fixture: 'document_filing',
    from: 'masked',
    event: 'file',
    record: { targetAccountId: 'acct-2' },
    code: 'forbidden',
    reason: 'file_customer_mismatch',
  },
  {
    fixture: 'document_filing',
    from: 'masked',
    event: 'file',
    record: { targetAccountId: null },
    code: 'forbidden',
    reason: 'file_customer_mismatch',
  },
  {
    fixture: 'document_filing',
    from: 'masked',
    event: 'file',
    record: { needsReview: true },
    actor: platform,
    code: 'conflict',
    reason: 'file_needs_review',
  },
  // Expense claim
  {
    fixture: 'expense_claim',
    from: 'draft',
    event: 'submit',
    record: { receiptsComplete: false },
    code: 'validation_failed',
    reason: 'expense_receipts_missing',
  },
  {
    fixture: 'expense_claim',
    from: 'draft',
    event: 'submit',
    record: { lineCount: 0 },
    code: 'validation_failed',
    reason: 'expense_receipts_missing',
  },
  {
    fixture: 'expense_claim',
    from: 'manager_approved',
    event: 'reimburse',
    code: 'conflict',
    reason: 'expense_claim_transition_not_allowed',
  },
  // Playbook directive
  {
    fixture: 'playbook_directive',
    from: 'draft',
    event: 'approve',
    record: { conflictsWith: [newId()] },
    code: 'conflict',
    reason: 'directive_conflict',
  },
  // Tally voucher
  {
    fixture: 'tally_voucher',
    from: 'received',
    event: 'match',
    record: { matchFound: false },
    actor: platform,
    code: 'conflict',
    reason: 'voucher_no_match',
  },
  {
    fixture: 'tally_voucher',
    from: 'received',
    event: 'queue',
    record: { matchFound: true },
    actor: platform,
    code: 'conflict',
    reason: 'voucher_has_match',
  },
  {
    fixture: 'tally_voucher',
    from: 'unlinked',
    event: 'link',
    params: { target: null },
    code: 'validation_failed',
    reason: 'voucher_link_target_missing',
  },
  {
    fixture: 'tally_voucher',
    from: 'linked',
    event: 'tombstone',
    record: { inSnapshot: true },
    actor: platform,
    code: 'conflict',
    reason: 'voucher_in_snapshot',
  },
];

describe('guards refuse with their own reason', () => {
  it.each(GUARDS)('$fixture $event from $from: $reason', (c) => {
    const fixture = fixtureOf(c.fixture);
    const base = setup(fixture, c.from, c.event);
    const record = { ...base.record, ...c.record };
    const params = { ...base.params, ...c.params };
    expect(() =>
      transition(fixture.machine, record, c.event, {
        actor: c.actor ?? everything(),
        now: c.now ?? base.now,
        params,
        ...(c.fixture === 'file_upload'
          ? { requirement: { permission: 'sales.quote.send', minScope: 'own' } as const }
          : {}),
      }),
    ).toThrow(
      expect.objectContaining({
        code: c.code,
        details: expect.objectContaining({ reason: c.reason }) as unknown,
      }),
    );
  });
});

describe('guards that let some actors through', () => {
  it('assign: a team lead may take over a locked opportunity, and so may the handover', () => {
    const fixture = setup(fixtureOf('opportunity'), 'open', 'assign');
    const record = { ...fixture.record, lockedUntil: new Date(NOW.getTime() + HOUR) };
    for (const actor of [holding([{ key: 'crm.lead.assign', scope: 'team' }]), platform]) {
      expect(
        transition(opportunityMachine, record as never, 'assign', { actor, now: NOW, params: {} })
          .to,
      ).toBe('open');
    }
  });

  it('assign: an expired lock no longer holds', () => {
    const fixture = setup(fixtureOf('opportunity'), 'open', 'assign');
    const record = { ...fixture.record, lockedUntil: NOW };
    const actor = holding([{ key: 'crm.lead.assign', scope: 'own' }]);
    expect(
      transition(opportunityMachine, record as never, 'assign', { actor, now: NOW, params: {} }).to,
    ).toBe('open');
  });

  it('reopen: from nurture there is no time limit; from lost exactly 30 days still counts', () => {
    const base = setup(fixtureOf('opportunity'), 'nurture', 'reopen');
    const old = { ...base.record, stateChangedAt: new Date(NOW.getTime() - 400 * DAY) };
    expect(
      transition(opportunityMachine, old as never, 'reopen', {
        actor: everything(),
        now: NOW,
        params: {},
      }).to,
    ).toBe('open');
    const lost = {
      ...base.record,
      state: 'lost',
      stateChangedAt: new Date(NOW.getTime() - 30 * DAY),
    };
    expect(
      transition(opportunityMachine, lost as never, 'reopen', {
        actor: everything(),
        now: NOW,
        params: {},
      }).to,
    ).toBe('open');
  });

  it('dispatch: at or below the threshold needs no e-way bill', () => {
    const base = setup(fixtureOf('dispatch'), 'ready', 'depart');
    const record = {
      ...base.record,
      consignmentValue: '50000.00',
      ewayBillNo: null,
      vehicleNo: null,
      ewayValidUntil: null,
    };
    expect(
      transition(dispatchMachine, record as never, 'depart', {
        actor: everything(),
        now: NOW,
        params: {},
      }).to,
    ).toBe('in_transit');
    const above = { ...record, consignmentValue: '50000.01' };
    expect(() =>
      transition(dispatchMachine, above as never, 'depart', {
        actor: everything(),
        now: NOW,
        params: {},
      }),
    ).toThrow(
      expect.objectContaining({
        details: expect.objectContaining({ reason: 'eway_bill_missing' }) as unknown,
      }),
    );
  });

  it('file upload: an event whose permission the input names is refused without it, or to someone without it', () => {
    const base = setup(fixtureOf('file_upload'), 'pending', 'complete');
    const fire = (actor: Actor, requirement?: Requirement) =>
      transition(fileUploadMachine, base.record as never, 'complete', {
        actor,
        now: base.now,
        params: base.params,
        ...(requirement === undefined ? {} : { requirement }),
      });
    expect(() => fire(everything())).toThrow(expect.objectContaining({ code: 'forbidden' }));
    const need: Requirement = { permission: 'admin.entities.write', minScope: 'all' };
    expect(() => fire(holding([{ key: 'admin.entities.write', scope: 'entity' }]), need)).toThrow(
      expect.objectContaining({ code: 'forbidden' }),
    );
    expect(fire(holding([{ key: 'admin.entities.write', scope: 'all' }]), need).to).toBe(
      'scanning',
    );
  });

  it('document filing: a person may file a classification the platform could not', () => {
    const base = setup(fixtureOf('document_filing'), 'masked', 'file');
    const record = { ...base.record, needsReview: true };
    expect(
      transition(documentFilingMachine, record as never, 'file', {
        actor: everything(),
        now: NOW,
        params: {},
      }).to,
    ).toBe('ready');
    const staffUpload = { ...base.record, senderAccountId: null, targetAccountId: 'acct-9' };
    expect(
      transition(documentFilingMachine, staffUpload as never, 'file', {
        actor: platform,
        now: NOW,
        params: {},
      }).to,
    ).toBe('ready');
  });

  it('expense claim: nobody approves their own claim, and the Accounts step is a second person', () => {
    const claimant = everything('accounts');
    const own = { ...setup(fixtureOf('expense_claim'), 'submitted', 'manager.approve').record };
    if (claimant.kind !== 'principal') throw new Error('expected a principal');
    const ownClaim = { ...own, claimantId: claimant.principal.id };
    expect(() =>
      transition(expenseClaimMachine, ownClaim as never, 'manager.approve', {
        actor: claimant,
        now: NOW,
        params: {},
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'forbidden',
        details: expect.objectContaining({ reason: 'expense_self_approval' }) as unknown,
      }),
    );
    const sameApprover = {
      ...own,
      state: 'manager_approved',
      managerApproverId: claimant.principal.id,
    };
    expect(() =>
      transition(expenseClaimMachine, sameApprover as never, 'accounts.approve', {
        actor: claimant,
        now: NOW,
        params: {},
      }),
    ).toThrow(
      expect.objectContaining({
        details: expect.objectContaining({ reason: 'expense_accounts_step' }) as unknown,
      }),
    );
    const other = { ...own, state: 'manager_approved' };
    expect(
      transition(expenseClaimMachine, other as never, 'accounts.approve', {
        actor: claimant,
        now: NOW,
        params: {},
      }).to,
    ).toBe('approved');
  });

  it('expense claim: the manager step needs approve at team scope, the Accounts step verify', () => {
    const team = holding([{ key: 'finance.expense.approve', scope: 'team' }], 'accounts');
    const base = setup(fixtureOf('expense_claim'), 'submitted', 'manager.approve');
    expect(
      transition(expenseClaimMachine, base.record as never, 'manager.approve', {
        actor: team,
        now: NOW,
        params: {},
      }).to,
    ).toBe('manager_approved');
    const accounts = { ...base.record, state: 'manager_approved' };
    expect(() =>
      transition(expenseClaimMachine, accounts as never, 'accounts.approve', {
        actor: team,
        now: NOW,
        params: {},
      }),
    ).toThrow(expect.objectContaining({ code: 'forbidden' }));
  });

  it('playbook directive: an agent can draft but never approve', () => {
    const agent: Actor = {
      kind: 'principal',
      principal: {
        id: newId(),
        kind: 'agent',
        roleKey: 'agent:chief',
        entityIds: [1],
        permissions: [],
      },
    };
    const base = setup(fixtureOf('playbook_directive'), 'draft', 'approve');
    expect(() =>
      transition(playbookDirectiveMachine, base.record as never, 'approve', {
        actor: agent,
        now: NOW,
        params: {},
      }),
    ).toThrow(expect.objectContaining({ code: 'forbidden' }));
    expect(() =>
      transition(playbookDirectiveMachine, base.record as never, 'approve', {
        actor: platform,
        now: NOW,
        params: {},
      }),
    ).toThrow(expect.objectContaining({ code: 'forbidden' }));
    expect(
      transition(playbookDirectiveMachine, { ...base.record, state: null } as never, 'create', {
        actor: platform,
        now: NOW,
        params: {},
      }).to,
    ).toBe('draft');
  });
});
