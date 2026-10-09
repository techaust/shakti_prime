export { defineCommand } from './command/define-command';
export type { AnyCommand, Command, PermissionByInput, Requirement } from './command/define-command';
export type { AuditChange, CommandContext, DomainEvent, NestedRunOptions } from './command/context';
export { runCommand, checkPermission, failureOf, RUNNER_REASONS } from './command/run-command';
export type { FailureStage, RunOptions } from './command/run-command';
export { AUTH_EVENT_FIELDS, redactAuthEvent, redactForAudit } from './audit/redact';
export { auditDevice, auditIp, databaseAuditSink, memoryAuditSink } from './audit/sink';
export type { AuditRecord, AuditSink, ClientMeta } from './audit/sink';
export { databaseOutboxSink, memoryOutboxSink } from './outbox/sink';
export type { OutboxRecord, OutboxSink } from './outbox/sink';
export { OUTBOX_BATCH_SIZE, OUTBOX_MAX_ATTEMPTS, runOutboxPublisher } from './outbox/publisher';
export type { OutboxPublisherOptions } from './outbox/publisher';
export { memoryEventPublisher } from './ports/event-publisher';
export { canonicalJson, inputHash } from './idempotency/hash';
export { databaseIdempotencyStore, memoryIdempotencyStore } from './idempotency/store';
export type { IdempotencyClaim, IdempotencyStore } from './idempotency/store';
export type { EventPublisher, PublishResult } from './ports/event-publisher';
export { commands, getCommand } from './command/registry';
export { executeCommand, executeQuery } from './command/execute';
export type { ExecuteOptions } from './command/execute';
export { updateEntity } from './commands/org/update-entity';
export { createLead } from './commands/crm/create-lead';
export { moveOpportunityStage } from './commands/crm/move-opportunity-stage';
export { assignOpportunity } from './commands/crm/assign-opportunity';
export { nurtureOpportunity } from './commands/crm/nurture-opportunity';
export { recordSizing } from './commands/crm/record-sizing';
export { reopenOpportunity } from './commands/crm/reopen-opportunity';
export { winOpportunity } from './commands/crm/win-opportunity';
export { loseOpportunity } from './commands/crm/lose-opportunity';
export {
  archiveStage,
  createStage,
  reorderStages,
  updatePipeline,
  updateStage,
} from './commands/crm/pipeline-settings';
export { setDispositions } from './commands/crm/set-dispositions';
export { setAccountTier } from './commands/crm/set-account-tier';
export { createQuote } from './commands/sales/create-quote';
export { sendQuote } from './commands/sales/send-quote';
export { requoteQuote } from './commands/sales/requote';
export { withdrawQuote } from './commands/sales/withdraw-quote';
export { expireQuotes, QUOTE_EXPIRY_BATCH } from './commands/sales/expire-quotes';
export { attachQuotePdf } from './commands/sales/attach-quote-pdf';
export { acceptQuote } from './commands/sales/accept-quote';
export { createSalesOrder } from './commands/sales/create-order';
export { confirmSalesOrder } from './commands/sales/confirm-order';
export { releaseCredit } from './commands/sales/release-credit';
export { cancelSalesOrder } from './commands/sales/cancel-order';
export { recordDealerOutstanding, setDealerTerms } from './commands/sales/dealer-credit';
export { setTarget } from './commands/sales/set-target';
export { myProgress, targetsScreen, teamProgress, currentStarts } from './queries/sales/targets';
export {
  homeCaller,
  homeCredit,
  homePipeline,
  homeResponseTimes,
  homeSales,
} from './queries/home/home';
export {
  isPeriodStart,
  periodBounds,
  periodEndOn,
  periodStartOn,
  progressFraction,
} from './sales/targets';
export { refreshLeadScores, rescoreLead, setScoreRules } from './commands/crm/score-rules';
export { dismissDuplicate, scanDuplicates, suggestDuplicate } from './commands/crm/duplicates';
export { mergeCustomers, mergeLeads, unmergeCustomers } from './commands/crm/merges';
export { setCommissionRule, setReferralPartner } from './commands/crm/referrals';
export { applyLeadAttribution, scoreLeads } from './commands/crm/lead-attribution';
export { scoreLead } from './crm/score';
export { createTask, completeTask, rescheduleTask, cancelTask } from './commands/crm/tasks';
export { createTag, archiveTag, tagLead, untagLead } from './commands/crm/tags';
export { updateAccount, updateContact, upsertSite, addNote } from './commands/crm/customer';
export { recordConsent, withdrawConsent } from './commands/crm/consent';
export { logCall } from './commands/calls/log-call';
export {
  dialNumber,
  listCallQueue,
  listTeamQueues,
  loadCallLead,
} from './queries/calls/call-queue';
export {
  afterUnanswered,
  callingStartOnDay,
  istDayStart,
  nurtureCallTimes,
} from './telecom/call-schedule';
export { setPrice } from './commands/pricing/set-price';
export {
  approvePriceList,
  archivePriceList,
  createPriceList,
} from './commands/pricing/price-lists';
export { archiveItem, createItem, updateItem } from './commands/catalogue/items';
export { archiveKit, createKit, updateKit } from './commands/catalogue/kits';
export { setPumpCurve } from './commands/catalogue/pump-curve';
export { setTaxRate } from './commands/tax/set-tax-rate';
export { setCompositeRule } from './commands/tax/set-composite-rule';
export { inviteUser } from './commands/admin/invite-user';
export { setUserRoles } from './commands/admin/set-user-roles';
export { setRolePermissions } from './commands/admin/set-role-permissions';
export { suspendUser, reactivateUser } from './commands/admin/user-status';
export { revokeSession } from './commands/admin/revoke-session';
export { resetTwoFactor } from './commands/admin/two-factor-reset';
export { clearSignInLock } from './commands/admin/clear-sign-in-lock';
export { replayDeadLetter } from './commands/integrations/replay-dead-letter';
export { runDeliveryProbe } from './commands/platform/run-probe';
export { requestPrintProof } from './commands/print/request-proof';
export { setTheme } from './commands/profile/set-theme';
export { setContrast } from './commands/profile/set-contrast';
export { deleteView, saveView } from './commands/profile/saved-views';
export { listSavedViews, toSavedViewDto } from './queries/profile/saved-views';
export { issueRealtimeToken } from './commands/realtime/issue-token';
export { createImportJob } from './commands/imports/create-job';
export { mapImportJob } from './commands/imports/map-job';
export { previewImportJob } from './commands/imports/preview-job';
export {
  commitImportBatch,
  commitImportJob,
  IMPORT_BATCH_BUDGET_MS,
  ROW_BY_ROW_SLICE_MS,
  SET_BASED_MIN_MS,
} from './commands/imports/commit-job';
export { rollbackImportJob } from './commands/imports/rollback-job';
export { failImportJob } from './commands/imports/fail-job';
export { lookupPin } from './queries/crm/pin-lookup';
export { gstStateCode } from './imports/gst-states';
export { checkAccountRow, companyNames, foldAccountRows } from './imports/accounts';
export { checkPinCodeRow, localityName } from './imports/pin-codes';
export {
  getImportJob,
  listImportJobs,
  listImportRows,
  listImportTemplates,
} from './queries/imports/import-queries';
export {
  parseImportFile,
  detectHeaderRow,
  detectImportFormat,
  importFileReadable,
} from './imports/parse';
export type { ImportFileReason, ParsedImportFile } from './imports/parse';
export { checkLeadRow, firstRowByPhone, leadCandidate } from './imports/leads';
export { assertImportJobMove, canMoveImportJob } from './imports/job-state';
export { importRowKey, rollbackChunks } from './imports/row-key';
export {
  assertFileKey,
  contentDisposition,
  localDiskFileStore,
  memoryFileStore,
  PRESIGN_SECONDS,
  rfc5987,
  sha256Hex,
  signLocalGrant,
  verifyLocalGrant,
} from './ports/file-store';
export type {
  FileStore,
  LocalDiskOptions,
  LocalGrant,
  PresignedGet,
  PresignedPut,
  PresignGetOptions,
  PresignPutRequest,
  StoredObject,
} from './ports/file-store';
export { loadUserDto } from './queries/admin/user-dto';
export {
  groupUserGrants,
  intersectGrants,
  parseUserAccess,
  resolvePrincipalFromGrants,
} from './auth/resolve-principal';
export type { EntityGrants, ResolveOutcome, UserAccess } from './auth/resolve-principal';
export {
  createLockout,
  createSignInGuard,
  lockoutDelaySeconds,
  LOCKOUT_FREE_ATTEMPTS,
  SIGN_IN_NOTICE_EVERY,
} from './auth/lockout';
export type { Lockout, SignInGuard } from './auth/lockout';
export { greaterNumber, memoryKeyValue } from './ports/key-value';
export type { KeyValue } from './ports/key-value';
export { consoleMailer, memoryMailer, recipientOnlyMailer } from './ports/mailer';
export { jsonLogger, memoryLogger, redact, redactError, redactText } from './ports/logger';
export type { Logger, LogLevel } from './ports/logger';
export type { Mailer, MailMessage } from './ports/mailer';
export { listAuditPeople, queryAudit, toAuditLogDto } from './queries/audit/query-audit';
export { companyStanding, listEntities } from './queries/org/list-entities';
export { readOutboxHealth } from './queries/platform/outbox-health';
export type { OutboxHealth } from './queries/platform/outbox-health';
export { ENTITY_COLUMNS, toEntityDto } from './queries/org/entity-dto';
export type { EntityRow } from './queries/org/entity-dto';
export {
  accountEnding,
  bankCipherContext,
  mayReadBankDetails,
  openBankDetails,
  readEntityBankDetails,
  readSealedBankDetails,
  sealBankDetails,
} from './queries/org/bank-details';
export { loadCompanyForPrint } from './queries/org/company-print';
export type { CompanyForPrint } from './queries/org/company-print';
export { listLeads, countLeads } from './queries/crm/list-leads';
export type { LeadPage, ListLeadsOptions } from './queries/crm/list-leads';
export { listBoardLeads, listBoardStageLeads } from './queries/crm/list-board-leads';
export { listLeadAssignees } from './queries/crm/list-lead-assignees';
export { latestSizing } from './queries/crm/latest-sizing';
export { listSizingPumps } from './queries/catalogue/list-sizing-pumps';
export { searchLeads } from './queries/crm/search-leads';
export { accountQuotes, getQuote, listQuotes, searchQuotes } from './queries/sales/list-quotes';
export { loadQuoteBuilder, previewQuote } from './queries/sales/quote-builder';
export {
  accountSalesOrders,
  getSalesOrder,
  listSalesOrders,
  salesOrderListQuery,
} from './queries/sales/list-orders';
export { loadSalesOrderBuilder, previewSalesOrder } from './queries/sales/order-facts';
export {
  dealerCreditHistory,
  dealerCreditQuery,
  listDealerCredit,
} from './queries/sales/dealer-credit';
export { listPriceTierOptions } from './queries/pricing/price-tiers';
export { loadQuoteForPrint } from './queries/sales/quote-print';
export type { QuoteForPrint } from './queries/sales/quote-print';
export { shownQuoteState } from './queries/sales/quote-dto';
export { priceQuote } from './sales/quote-pricing';
export { listCustomers, listTimeline, loadAccount360, listMyTasks } from './queries/crm/customers';
export { listAccountDuplicates, listDuplicates, countMergeMoves } from './queries/crm/duplicates';
export { searchPeople } from './queries/admin/search-people';
export { toLeadDto } from './queries/crm/lead-dto';
export { listItems, listItemsWithCost } from './queries/catalogue/list-items';
export type { ListItemsOptions } from './queries/catalogue/list-items';
export { getItem, getKit, listKits } from './queries/catalogue/catalogue-queries';
export { listKitPrices, listPriceChanges } from './queries/pricing/price-history';
export { readTaxSettings, requestCoversAllCompanies } from './queries/tax/tax-settings';
export { listUsers, listUserSessions } from './queries/admin/list-users';
export { getRoleGrants, listRoles } from './queries/admin/roles';
export { listPipelines, listLeadSources } from './queries/crm/list-pipelines';
export {
  effectiveDispositions,
  listCodedReferralPartners,
  listCommissionRules,
  listDispositions,
  listPipelineSettings,
  listReferralPartners,
  listScoreRules,
} from './queries/crm/pipeline-settings';
export { listPriceLists, listPrices } from './queries/pricing/list-prices';
export { toItemDto, toItemWithCostDto } from './queries/catalogue/item-dto';
export {
  documentPrefix,
  financialYear,
  formatDocumentNo,
  istCalendarDate,
} from './numbering/financial-year';
export { nextDocumentNo } from './numbering/next-document-no';
export { verhoeffCheckDigit, verhoeffValid } from './privacy/verhoeff';
export {
  AADHAAR_VISIBLE_FROM,
  findIdentityNumbers,
  isAadhaarNumber,
  maskedDigitIndices,
  maskIdentityNumbers,
  maskLine,
  normalizeOcrDigits,
  summarizeSpans,
} from './privacy/identity-numbers';
export type {
  IdentityNumberKind,
  IdentityNumberSpan,
  LineMask,
  MaskedText,
} from './privacy/identity-numbers';
export { WORKSHOP_DEFAULTS } from './workshop-defaults';
export type { SizingDefaults, WorkshopDefaults } from './workshop-defaults';
export { divideHalfUp, fromPaise, moneyFromPaise, toPaise, toScaled } from './money/paise';
export {
  computeDocument,
  computeLine,
  compositeSplit,
  effectiveOn,
  placeOfSupply,
  resolveCompositeRule,
  resolveRate,
} from './tax';
export type { CompositeParts, CompositeQuery, LineInput, RateQuery, SupplyParties } from './tax';
export {
  dcrRule,
  hazenWilliamsLossM,
  KW_PER_HP,
  nextStandardHp,
  pumpDutyPoint,
  pumpMatch,
  pumpPower,
  pumpSpecsOf,
  quoteSizingFacts,
  rooftopSize,
  sanctionedLoadRule,
  SIZING_ENGINE_VERSION,
  sizePump,
  sizeRooftop,
  solarArrayForPump,
  suctionLift,
  totalDynamicHead,
} from './sizing';
export type {
  Bounded,
  ChosenPump,
  CurvePoint,
  DcrRuleInput,
  DcrRuleResult,
  DutyPointResult,
  HeadInput,
  HeadResult,
  ModuleLine,
  PowerInput,
  PowerResult,
  PumpMatchInput,
  PumpMatchResult,
  PumpSpecs,
  QuoteSizingContext,
  QuoteSizingFacts,
  RooftopInput,
  RooftopResult,
  SanctionedLoadInput,
  SolarPumpInput,
  SolarPumpResult,
  SuctionInput,
  SuctionResult,
} from './sizing';
export { creditCheck } from './sales/credit-check';
export { commissionAmount } from './sales/commission';
export type { Commission, CommissionFacts } from './sales/commission';
export type { CreditFacts, CreditOutcome, CreditRelease } from './sales/credit-check';
export {
  allOf,
  defineMachine,
  findTransition,
  reasonGiven,
  transition,
} from './state-machines/define-machine';
export type {
  Actor,
  AnyMachine,
  Effect,
  Guard,
  GuardFailure,
  Machine,
  MachineRecord,
  MachineSpec,
  TransitionContext,
  TransitionResult,
  TransitionSpec,
} from './state-machines/define-machine';
export { MACHINE_REASONS, MACHINES } from './state-machines/registry';
export { renderAll } from './state-machines/render';
export { opportunityMachine } from './state-machines/machines/opportunity';
export type { OpportunityParams, OpportunityRecord } from './state-machines/machines/opportunity';
export { quoteMachine, quoteValidUntil } from './state-machines/machines/quote';
export type { QuoteParams, QuoteRecord } from './state-machines/machines/quote';
export { salesOrderMachine } from './state-machines/machines/sales-order';
export type { SalesOrderParams, SalesOrderRecord } from './state-machines/machines/sales-order';
export { dispatchMachine, needsEwayBill } from './state-machines/machines/dispatch';
export type { DispatchParams, DispatchRecord } from './state-machines/machines/dispatch';
export { projectStandardMachine } from './state-machines/machines/project-standard';
export { projectSuryaGharMachine } from './state-machines/machines/project-surya-ghar';
export { subsidyGateMachine } from './state-machines/machines/subsidy-gate';
export { customerLoanMachine } from './state-machines/machines/customer-loan';
export { warrantyClaimMachine } from './state-machines/machines/warranty-claim';
export { documentFilingMachine } from './state-machines/machines/document-filing';
export { expenseClaimMachine } from './state-machines/machines/expense-claim';
export { playbookDirectiveMachine } from './state-machines/machines/playbook-directive';
export { tallyVoucherMachine } from './state-machines/machines/tally-voucher';
export {
  CALLING_WINDOW_IST,
  checkDial,
  isIndianMobile,
  istMinuteOfDay,
  nationalNumber,
  nextCallingWindowStart,
  numberSeries,
  withinCallingHours,
} from './telecom/dial-policy';
export type {
  CallPurpose,
  DialDecision,
  DialRefusal,
  DialRequest,
  NumberSeries,
} from './telecom/dial-policy';
export {
  checkBatch,
  connectorHealth,
  DEFAULT_SNAPSHOT_LIMITS,
  diffSnapshot,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_SILENCE_MS,
  shouldAlertSilence,
} from './tally/sync-rules';
export type {
  BatchCheck,
  BatchOutcome,
  BatchVoucherRef,
  ConnectorHealth,
  SnapshotCheck,
  SnapshotDiff,
  SnapshotLimits,
  StoredVoucher,
} from './tally/sync-rules';
export { beginUpload } from './commands/files/begin-upload';
export { completeUpload } from './commands/files/complete-upload';
export { AWAITING_CHECKS, recheckFiles } from './commands/files/recheck-files';
export { sweepUploads } from './commands/files/sweep-uploads';
export { countFilesAwaitingChecks } from './queries/files/file-queries';
export {
  continueFileCheck,
  markFileReady,
  markFileScanned,
  rejectFile,
} from './commands/files/check-file';
export { recordRenderedFile } from './commands/files/record-rendered';
export {
  getFile,
  getStoredFile,
  listCompanyFiles,
  staleUploadCompanies,
} from './queries/files/file-queries';
export type { StoredFile } from './queries/files/file-queries';
export {
  FILE_PURPOSE_RULES,
  filePurposeGrant,
  UPLOADABLE_PURPOSES,
  uploadPermission,
} from './files/purposes';
export type { FilePurposeRule } from './files/purposes';
export { EXTENSIONS, UPLOAD_LIMITS, uploadKey, uploadLimitProblem } from './files/limits';
export type { UploadLimit, UploadLimitProblem } from './files/limits';
export { fileUploadMachine } from './state-machines/machines/file-upload';
export {
  contextBytes,
  contextFields,
  envelopeCipher,
  FieldCipherError,
  FieldEnvelopeSchema,
  localKeyProvider,
} from './privacy/field-cipher';
export type {
  CipherContext,
  DataKeyProvider,
  FieldCipher,
  FieldEnvelope,
} from './privacy/field-cipher';
export { createAiProvider, istDay, spendKey } from './ai/provider';
export type {
  AiProvider,
  AiProviderDeps,
  CompleteCall,
  CompleteResult,
  EmbedCall,
  EmbedResult,
  SpendCap,
} from './ai/provider';
export { fakeEmbedding, fakeModelTransport, fakeReply, ModelCallError } from './ai/transport';
export type {
  EmbeddingTransport,
  FakeModelTransport,
  FakeStep,
  ModelReply,
  ModelRequest,
  ModelTransport,
} from './ai/transport';
export { vendorTransports } from './ai/env';
export { costInPaise, DEFAULT_CLAUDE_MODEL, DEFAULT_EMBEDDING_MODEL } from './ai/models';
export { AGENT_ACTION_TYPES, AUTOMATIC_AVAILABLE, automaticEarned } from './ai/action-types';
export { AGENT_DEFAULTS } from './ai/agent-defaults';
export { resolveAgentConfig } from './ai/config';
export { agentPrincipal, agentStepKey, runAgentStep } from './ai/runtime';
export type { AgentStep, AgentStepDeps, RunModel } from './ai/runtime';
export { maskForModel, labelUntrusted } from './privacy/model-text';
export { recordAgentRun } from './commands/agents/record-run';
export {
  approveInboxItem,
  completeInboxItem,
  dismissInboxItem,
  editInboxItem,
  rejectInboxItem,
} from './commands/agents/inbox';
export { routeEnquiry } from './commands/crm/route-enquiry';
export { notifyEvent, recordPush, scanNotices } from './commands/notifications/notify';
export {
  markAllNoticesRead,
  markNoticesRead,
  setNotificationSettings,
  subscribePush,
  unsubscribePush,
} from './commands/notifications/own';
export { countNotices, listNotices } from './queries/notifications/notices';
export { loadNotificationSettings } from './queries/notifications/settings';
export {
  choiceFor,
  inQuietHours,
  NOTICE_LOOKBACK_MS,
  NOTICE_SCAN_LIMIT,
  pushPlan,
  QUOTE_EXPIRY_NOTICE_MS,
} from './notifications/push-plan';
export { setAgentConfig, setKillSwitch } from './commands/agents/config';
export { countInbox, listInbox } from './queries/agents/inbox';
export { loadAgentSettings } from './queries/agents/settings';
export {
  addKnowledgeFile,
  archiveKnowledgeFile,
  reindexKnowledgeFile,
} from './commands/knowledge/files';
export { recordKnowledgeIndex } from './commands/knowledge/record-index';
export { knowledgeFileForIndex } from './commands/knowledge/shared';
export {
  KNOWLEDGE_PAGE_SIZE,
  listKnowledgeFiles,
  searchKnowledge,
} from './queries/knowledge/vault';
export { chunkText, KNOWLEDGE_CHUNKING } from './knowledge/chunk';
export {
  extractWorkbook,
  KNOWLEDGE_EXTRACT_SYSTEM,
  knowledgeSourceType,
} from './knowledge/extract';
export { EMBED_BATCH, indexKnowledgeFile } from './knowledge/index-file';
export type { IndexKnowledgeDeps, IndexKnowledgeOutcome } from './knowledge/index-file';
export { knowledgeQueryVector } from './knowledge/search';
export { checkZipArchive } from './imports/zip-guard';
