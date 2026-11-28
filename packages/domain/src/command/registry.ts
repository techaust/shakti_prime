import { DomainError } from '@shakti/contracts';
import { clearSignInLock } from '../commands/admin/clear-sign-in-lock';
import { setAgentConfig, setKillSwitch } from '../commands/agents/config';
import {
  approveInboxItem,
  completeInboxItem,
  dismissInboxItem,
  editInboxItem,
  rejectInboxItem,
} from '../commands/agents/inbox';
import { recordAgentRun } from '../commands/agents/record-run';
import { recordCopilotNote } from '../commands/agents/notes';
import { requestCopilotBrief } from '../commands/agents/brief-request';
import { attachCallTranscript, reserveCallTranscript } from '../commands/calls/call-transcript';
import { inviteUser } from '../commands/admin/invite-user';
import { revokeSession } from '../commands/admin/revoke-session';
// F1 field app foundation.
import { setFeatureFlag } from '../commands/admin/set-feature-flag';
import { revokeMobileDevice } from '../commands/field/revoke-device';
import { setRolePermissions } from '../commands/admin/set-role-permissions';
import { setUserRoles } from '../commands/admin/set-user-roles';
import { resetTwoFactor } from '../commands/admin/two-factor-reset';
import { reactivateUser, suspendUser } from '../commands/admin/user-status';
import { dialCall } from '../commands/calls/dial-call';
import { recordInboundCall, signalRinging } from '../commands/calls/inbound-calls';
import { logCall } from '../commands/calls/log-call';
import { playCallRecording } from '../commands/calls/play-recording';
import {
  attachCallRecording,
  deleteCallRecording,
  recordProviderCall,
} from '../commands/calls/provider-calls';
import { assignOpportunity } from '../commands/crm/assign-opportunity';
import { setCallerProfile, setDialPhone, setPresence } from '../commands/crm/caller-profiles';
import { handOverLead } from '../commands/crm/hand-over-lead';
import { reassignAllLeads } from '../commands/crm/reassign-all';
import { createLead } from '../commands/crm/create-lead';
import { loseOpportunity } from '../commands/crm/lose-opportunity';
import { moveOpportunityStage } from '../commands/crm/move-opportunity-stage';
import { nurtureOpportunity } from '../commands/crm/nurture-opportunity';
import {
  archiveStage,
  createStage,
  reorderStages,
  updatePipeline,
  updateStage,
} from '../commands/crm/pipeline-settings';
import {
  createReferralPartner,
  setCommissionRule,
  setReferralPartner,
} from '../commands/crm/referrals';
import { refreshLeadScores, rescoreLead, setScoreRules } from '../commands/crm/score-rules';
import { setAccountTier } from '../commands/crm/set-account-tier';
import { setDispositions } from '../commands/crm/set-dispositions';
import { recordSizing } from '../commands/crm/record-sizing';
import { dismissDuplicate, scanDuplicates, suggestDuplicate } from '../commands/crm/duplicates';
import { mergeCustomers, mergeLeads, unmergeCustomers } from '../commands/crm/merges';
import { reopenOpportunity } from '../commands/crm/reopen-opportunity';
import { recordConsent, withdrawConsent } from '../commands/crm/consent';
import { addNote, updateAccount, updateContact, upsertSite } from '../commands/crm/customer';
import { archiveTag, createTag, tagLead, untagLead } from '../commands/crm/tags';
import { cancelTask, completeTask, createTask, rescheduleTask } from '../commands/crm/tasks';
import { winOpportunity } from '../commands/crm/win-opportunity';
import { routeEnquiry } from '../commands/crm/route-enquiry';
import { takeEnquiry } from '../commands/crm/take-enquiry';
import { notifyEvent, recordPush, scanNotices } from '../commands/notifications/notify';
import {
  markAllNoticesRead,
  markNoticesRead,
  setNotificationSettings,
  subscribePush,
  unsubscribePush,
} from '../commands/notifications/own';
import { beginUpload } from '../commands/files/begin-upload';
import {
  continueFileCheck,
  markFileReady,
  markFileScanned,
  rejectFile,
} from '../commands/files/check-file';
import { completeUpload } from '../commands/files/complete-upload';
import { recheckFiles } from '../commands/files/recheck-files';
import { sweepUploads } from '../commands/files/sweep-uploads';
import { recordRenderedFile } from '../commands/files/record-rendered';
import { retireRenderedFiles } from '../commands/files/retire-rendered';
import {
  addKnowledgeFile,
  archiveKnowledgeFile,
  reindexKnowledgeFile,
} from '../commands/knowledge/files';
import { recordKnowledgeIndex } from '../commands/knowledge/record-index';
import {
  correctKnowledgeTranscript,
  recordKnowledgeTranscript,
} from '../commands/knowledge/transcript';
import {
  approvePlaybookDirective,
  draftPlaybookDirective,
  editPlaybookDirective,
  resolvePlaybookConflict,
  retirePlaybookDirective,
} from '../commands/knowledge/playbook';
import { recordPlaybookCheck } from '../commands/knowledge/playbook-check';
import { draftPlaybookFromFile } from '../commands/knowledge/playbook-from-file';
import { deleteAskConversation, recordAsk } from '../commands/knowledge/ask';
import { commitImportBatch, commitImportJob } from '../commands/imports/commit-job';
import { createImportJob } from '../commands/imports/create-job';
import { failImportJob } from '../commands/imports/fail-job';
import { mapImportJob } from '../commands/imports/map-job';
import { previewImportJob } from '../commands/imports/preview-job';
import { maskImportIdentity, recordImportPurgeFailure } from '../commands/imports/mask-identity';
import { purgeImportRows, recordImportFilesDeleted } from '../commands/imports/purge';
import { rollbackImportJob } from '../commands/imports/rollback-job';
import { replayDeadLetter } from '../commands/integrations/replay-dead-letter';
import { updateEntity } from '../commands/org/update-entity';
import { archiveEntityChannel, setEntityChannel } from '../commands/org/channels';
import { recordPhoneDnd } from '../commands/crm/record-phone-dnd';
import { sendWhatsAppReply } from '../commands/messaging/reply';
import { sendWhatsAppMessage } from '../commands/messaging/send-message';
import { requestTemplate } from '../commands/messaging/template-request';
import { handOffWhatsAppThread, returnWhatsAppThread } from '../commands/messaging/threads';
import { registerWhatsAppTemplate } from '../commands/messaging/templates';
import { sendWhatsAppMilestone, setWhatsAppMilestone } from '../commands/messaging/milestones';
import { queueWhatsAppAnswer } from '../commands/messaging/answers';
// W2 media retention.
import {
  expireWhatsAppMedia,
  recordWhatsAppMediaOrphans,
} from '../commands/messaging/media-retention';
import {
  attachWhatsAppMedia,
  claimWhatsAppMessage,
  matchWhatsAppThread,
  queueWhatsAppMessage,
  recordInboundWhatsApp,
  recordWhatsAppHandOff,
  recordWhatsAppOptOut,
  recordWhatsAppSend,
  recordWhatsAppStatus,
  recordWhatsAppTemplateStatus,
} from '../commands/messaging/platform';
import { ingestLead } from '../commands/crm/ingest-lead';
import { setLeadQualification } from '../commands/crm/lead-qualification';
import {
  archiveIngestSource,
  createIngestKey,
  recordSourceQuestions,
  revokeIngestKey,
  setIngestSource,
} from '../commands/crm/ingest-sources';
import { archiveItem, createItem, updateItem } from '../commands/catalogue/items';
import { archiveKit, createKit, updateKit } from '../commands/catalogue/kits';
import { setPumpCurve } from '../commands/catalogue/pump-curve';
// J1 projects
import { assignProject } from '../commands/projects/assign-project';
import { cancelForOrder } from '../commands/projects/cancel-for-order';
import { createProject, draftProject } from '../commands/projects/create-project';
import {
  cancelProject,
  completeMilestone,
  completeProject,
  holdProject,
  resumeProject,
} from '../commands/projects/move-project';
import { publishProjectTemplate } from '../commands/projects/publish-template';
// H1 stock ledger
import {
  archiveBin,
  archiveHub,
  createBin,
  createHub,
  updateBin,
  updateHub,
} from '../commands/inventory/hubs';
import { adjustStock, reverseStock, transferStock } from '../commands/inventory/stock';
// Q1 labels
import { printLabels, reprintLabels } from '../commands/inventory/labels';
import {
  approvePriceList,
  archivePriceList,
  createPriceList,
} from '../commands/pricing/price-lists';
import { runDeliveryProbe } from '../commands/platform/run-probe';
import { requestPrintProof } from '../commands/print/request-proof';
import { setPrice } from '../commands/pricing/set-price';
import { acceptQuote } from '../commands/sales/accept-quote';
import { acceptQuoteRemote } from '../commands/sales/accept-quote-remote';
import { attachQuotePdf } from '../commands/sales/attach-quote-pdf';
import { cancelSalesOrder } from '../commands/sales/cancel-order';
import { confirmSalesOrder } from '../commands/sales/confirm-order';
import { createSalesOrder } from '../commands/sales/create-order';
import { recordDealerOutstanding, setDealerTerms } from '../commands/sales/dealer-credit';
import { setTarget } from '../commands/sales/set-target';
import { createQuote } from '../commands/sales/create-quote';
import { expireQuotes } from '../commands/sales/expire-quotes';
import { anonymiseStaleLeads } from '../commands/crm/anonymise-stale-leads';
import {
  claimWebhook,
  markWebhook,
  replayWebhook,
  sweepWebhooks,
} from '../commands/webhooks/inbox';
import { releaseCredit } from '../commands/sales/release-credit';
import { requoteQuote } from '../commands/sales/requote';
import { sendQuote } from '../commands/sales/send-quote';
import { withdrawQuote } from '../commands/sales/withdraw-quote';
import { deleteView, saveView } from '../commands/profile/saved-views';
import { setTheme } from '../commands/profile/set-theme';
import { issueRealtimeToken } from '../commands/realtime/issue-token';
import {
  recordVoiceSession,
  refreshVoiceToken,
  startVoiceSession,
} from '../commands/voice/sessions';
import { setContrast } from '../commands/profile/set-contrast';
import { setCompositeRule } from '../commands/tax/set-composite-rule';
import { setTaxRate } from '../commands/tax/set-tax-rate';
// U1 vendors and supplier quotes.
import { archiveVendor, createVendor, updateVendor } from '../commands/procurement/vendors';
import { setItemVendor, setVendorContacts } from '../commands/procurement/vendor-links';
import { recordVendorQuote, withdrawVendorQuote } from '../commands/procurement/quotes';
// FN1 proformas and payment milestones.
import {
  attachProformaPdf,
  cancelProforma,
  refreshMilestones,
  settleCancelledOrder,
  issueProforma,
  planConfirmedMilestones,
  planMilestonesByHand,
  publishPaymentTerms,
  waiveMilestone,
} from '../commands/finance/index';
// J2 customer loans.
import { createCustomerLoan } from '../commands/crm/loans-create';
import { sanctionCustomerLoan } from '../commands/crm/loans-sanction';
import { disburseCustomerLoan } from '../commands/crm/loans-disburse';
import { rejectCustomerLoan } from '../commands/crm/loans-reject';
import { waiveLoanGates } from '../commands/crm/loans-waive';
import { createLender, updateLender } from '../commands/crm/loans-lenders';
import type { AnyCommand } from './define-command';

/** Every command the system can perform, by name. Agents, voice and imports call through here. */
/** Frozen: no command can be added, replaced or removed at run time (audit ARCH-1). */
export const commands = Object.freeze({
  [updateEntity.name]: updateEntity,
  [setEntityChannel.name]: setEntityChannel,
  [archiveEntityChannel.name]: archiveEntityChannel,
  [recordPhoneDnd.name]: recordPhoneDnd,
  [sendWhatsAppMessage.name]: sendWhatsAppMessage,
  [sendWhatsAppReply.name]: sendWhatsAppReply,
  [requestTemplate.name]: requestTemplate,
  [handOffWhatsAppThread.name]: handOffWhatsAppThread,
  [returnWhatsAppThread.name]: returnWhatsAppThread,
  [registerWhatsAppTemplate.name]: registerWhatsAppTemplate,
  [recordInboundWhatsApp.name]: recordInboundWhatsApp,
  [matchWhatsAppThread.name]: matchWhatsAppThread,
  [recordWhatsAppStatus.name]: recordWhatsAppStatus,
  [recordWhatsAppTemplateStatus.name]: recordWhatsAppTemplateStatus,
  [recordWhatsAppOptOut.name]: recordWhatsAppOptOut,
  [recordWhatsAppHandOff.name]: recordWhatsAppHandOff,
  [queueWhatsAppMessage.name]: queueWhatsAppMessage,
  [claimWhatsAppMessage.name]: claimWhatsAppMessage,
  [recordWhatsAppSend.name]: recordWhatsAppSend,
  [attachWhatsAppMedia.name]: attachWhatsAppMedia,
  [setWhatsAppMilestone.name]: setWhatsAppMilestone,
  [sendWhatsAppMilestone.name]: sendWhatsAppMilestone,
  [queueWhatsAppAnswer.name]: queueWhatsAppAnswer,
  // W2 media retention.
  [expireWhatsAppMedia.name]: expireWhatsAppMedia,
  [recordWhatsAppMediaOrphans.name]: recordWhatsAppMediaOrphans,
  [ingestLead.name]: ingestLead,
  [setLeadQualification.name]: setLeadQualification,
  [setIngestSource.name]: setIngestSource,
  [archiveIngestSource.name]: archiveIngestSource,
  [createIngestKey.name]: createIngestKey,
  [revokeIngestKey.name]: revokeIngestKey,
  [recordSourceQuestions.name]: recordSourceQuestions,
  [createLead.name]: createLead,
  [moveOpportunityStage.name]: moveOpportunityStage,
  [assignOpportunity.name]: assignOpportunity,
  [setCallerProfile.name]: setCallerProfile,
  [setPresence.name]: setPresence,
  [setDialPhone.name]: setDialPhone,
  [handOverLead.name]: handOverLead,
  [reassignAllLeads.name]: reassignAllLeads,
  [nurtureOpportunity.name]: nurtureOpportunity,
  [reopenOpportunity.name]: reopenOpportunity,
  [winOpportunity.name]: winOpportunity,
  [loseOpportunity.name]: loseOpportunity,
  [updatePipeline.name]: updatePipeline,
  [createStage.name]: createStage,
  [updateStage.name]: updateStage,
  [reorderStages.name]: reorderStages,
  [archiveStage.name]: archiveStage,
  [setDispositions.name]: setDispositions,
  [setScoreRules.name]: setScoreRules,
  [rescoreLead.name]: rescoreLead,
  [refreshLeadScores.name]: refreshLeadScores,
  [setReferralPartner.name]: setReferralPartner,
  [createReferralPartner.name]: createReferralPartner,
  [setCommissionRule.name]: setCommissionRule,
  [recordSizing.name]: recordSizing,
  [scanDuplicates.name]: scanDuplicates,
  [dismissDuplicate.name]: dismissDuplicate,
  [suggestDuplicate.name]: suggestDuplicate,
  [mergeCustomers.name]: mergeCustomers,
  [unmergeCustomers.name]: unmergeCustomers,
  [mergeLeads.name]: mergeLeads,
  [createTask.name]: createTask,
  [completeTask.name]: completeTask,
  [rescheduleTask.name]: rescheduleTask,
  [cancelTask.name]: cancelTask,
  [createTag.name]: createTag,
  [archiveTag.name]: archiveTag,
  [tagLead.name]: tagLead,
  [untagLead.name]: untagLead,
  [updateAccount.name]: updateAccount,
  [updateContact.name]: updateContact,
  [upsertSite.name]: upsertSite,
  [addNote.name]: addNote,
  [recordConsent.name]: recordConsent,
  [withdrawConsent.name]: withdrawConsent,
  [logCall.name]: logCall,
  [dialCall.name]: dialCall,
  [recordProviderCall.name]: recordProviderCall,
  [recordInboundCall.name]: recordInboundCall,
  [signalRinging.name]: signalRinging,
  [attachCallRecording.name]: attachCallRecording,
  [deleteCallRecording.name]: deleteCallRecording,
  [playCallRecording.name]: playCallRecording,
  [startVoiceSession.name]: startVoiceSession,
  [refreshVoiceToken.name]: refreshVoiceToken,
  [recordVoiceSession.name]: recordVoiceSession,
  [setPrice.name]: setPrice,
  [createPriceList.name]: createPriceList,
  [approvePriceList.name]: approvePriceList,
  [archivePriceList.name]: archivePriceList,
  [createItem.name]: createItem,
  // H1 stock ledger
  [createHub.name]: createHub,
  [updateHub.name]: updateHub,
  [archiveHub.name]: archiveHub,
  [createBin.name]: createBin,
  [updateBin.name]: updateBin,
  [archiveBin.name]: archiveBin,
  [transferStock.name]: transferStock,
  [adjustStock.name]: adjustStock,
  [reverseStock.name]: reverseStock,
  // Q1 labels
  [printLabels.name]: printLabels,
  [reprintLabels.name]: reprintLabels,
  [updateItem.name]: updateItem,
  [archiveItem.name]: archiveItem,
  [createKit.name]: createKit,
  [updateKit.name]: updateKit,
  [archiveKit.name]: archiveKit,
  [setPumpCurve.name]: setPumpCurve,
  [setTaxRate.name]: setTaxRate,
  [setCompositeRule.name]: setCompositeRule,
  [inviteUser.name]: inviteUser,
  [setUserRoles.name]: setUserRoles,
  [setRolePermissions.name]: setRolePermissions,
  [suspendUser.name]: suspendUser,
  [reactivateUser.name]: reactivateUser,
  [revokeSession.name]: revokeSession,
  [resetTwoFactor.name]: resetTwoFactor,
  [clearSignInLock.name]: clearSignInLock,
  [replayDeadLetter.name]: replayDeadLetter,
  [runDeliveryProbe.name]: runDeliveryProbe,
  [setTheme.name]: setTheme,
  [setContrast.name]: setContrast,
  [saveView.name]: saveView,
  [deleteView.name]: deleteView,
  [issueRealtimeToken.name]: issueRealtimeToken,
  [createImportJob.name]: createImportJob,
  [mapImportJob.name]: mapImportJob,
  [previewImportJob.name]: previewImportJob,
  [commitImportJob.name]: commitImportJob,
  [commitImportBatch.name]: commitImportBatch,
  [rollbackImportJob.name]: rollbackImportJob,
  [failImportJob.name]: failImportJob,
  [maskImportIdentity.name]: maskImportIdentity,
  [recordImportPurgeFailure.name]: recordImportPurgeFailure,
  [purgeImportRows.name]: purgeImportRows,
  [recordImportFilesDeleted.name]: recordImportFilesDeleted,
  [beginUpload.name]: beginUpload,
  [completeUpload.name]: completeUpload,
  [markFileScanned.name]: markFileScanned,
  [markFileReady.name]: markFileReady,
  [rejectFile.name]: rejectFile,
  [recheckFiles.name]: recheckFiles,
  [continueFileCheck.name]: continueFileCheck,
  [sweepUploads.name]: sweepUploads,
  [recordRenderedFile.name]: recordRenderedFile,
  [retireRenderedFiles.name]: retireRenderedFiles,
  [requestPrintProof.name]: requestPrintProof,
  [setAccountTier.name]: setAccountTier,
  [createQuote.name]: createQuote,
  [sendQuote.name]: sendQuote,
  [requoteQuote.name]: requoteQuote,
  [withdrawQuote.name]: withdrawQuote,
  [expireQuotes.name]: expireQuotes,
  [anonymiseStaleLeads.name]: anonymiseStaleLeads,
  [claimWebhook.name]: claimWebhook,
  [markWebhook.name]: markWebhook,
  [sweepWebhooks.name]: sweepWebhooks,
  [replayWebhook.name]: replayWebhook,
  [attachQuotePdf.name]: attachQuotePdf,
  [acceptQuote.name]: acceptQuote,
  [acceptQuoteRemote.name]: acceptQuoteRemote,
  [createSalesOrder.name]: createSalesOrder,
  [confirmSalesOrder.name]: confirmSalesOrder,
  [releaseCredit.name]: releaseCredit,
  [cancelSalesOrder.name]: cancelSalesOrder,
  [setDealerTerms.name]: setDealerTerms,
  [recordDealerOutstanding.name]: recordDealerOutstanding,
  [setTarget.name]: setTarget,
  [recordAgentRun.name]: recordAgentRun,
  [recordCopilotNote.name]: recordCopilotNote,
  [requestCopilotBrief.name]: requestCopilotBrief,
  [attachCallTranscript.name]: attachCallTranscript,
  [reserveCallTranscript.name]: reserveCallTranscript,
  [approveInboxItem.name]: approveInboxItem,
  [editInboxItem.name]: editInboxItem,
  [rejectInboxItem.name]: rejectInboxItem,
  [dismissInboxItem.name]: dismissInboxItem,
  [setAgentConfig.name]: setAgentConfig,
  [setKillSwitch.name]: setKillSwitch,
  [addKnowledgeFile.name]: addKnowledgeFile,
  [reindexKnowledgeFile.name]: reindexKnowledgeFile,
  [archiveKnowledgeFile.name]: archiveKnowledgeFile,
  [recordKnowledgeIndex.name]: recordKnowledgeIndex,
  [recordKnowledgeTranscript.name]: recordKnowledgeTranscript,
  [correctKnowledgeTranscript.name]: correctKnowledgeTranscript,
  [draftPlaybookDirective.name]: draftPlaybookDirective,
  [editPlaybookDirective.name]: editPlaybookDirective,
  [approvePlaybookDirective.name]: approvePlaybookDirective,
  [retirePlaybookDirective.name]: retirePlaybookDirective,
  [resolvePlaybookConflict.name]: resolvePlaybookConflict,
  [recordPlaybookCheck.name]: recordPlaybookCheck,
  [draftPlaybookFromFile.name]: draftPlaybookFromFile,
  [recordAsk.name]: recordAsk,
  [deleteAskConversation.name]: deleteAskConversation,
  [completeInboxItem.name]: completeInboxItem,
  [routeEnquiry.name]: routeEnquiry,
  [takeEnquiry.name]: takeEnquiry,
  [notifyEvent.name]: notifyEvent,
  [scanNotices.name]: scanNotices,
  [recordPush.name]: recordPush,
  [markNoticesRead.name]: markNoticesRead,
  [markAllNoticesRead.name]: markAllNoticesRead,
  [setNotificationSettings.name]: setNotificationSettings,
  [subscribePush.name]: subscribePush,
  [unsubscribePush.name]: unsubscribePush,
  // U1 vendors and supplier quotes (docs/03-roadmap-appendix/phase3.md §6.3).
  [createVendor.name]: createVendor,
  [updateVendor.name]: updateVendor,
  [archiveVendor.name]: archiveVendor,
  [setVendorContacts.name]: setVendorContacts,
  [setItemVendor.name]: setItemVendor,
  [recordVendorQuote.name]: recordVendorQuote,
  [withdrawVendorQuote.name]: withdrawVendorQuote,
  // FN1 proformas and payment milestones (docs/03-roadmap-appendix/phase5.md §6.1).
  [issueProforma.name]: issueProforma,
  [cancelProforma.name]: cancelProforma,
  [planMilestonesByHand.name]: planMilestonesByHand,
  [planConfirmedMilestones.name]: planConfirmedMilestones,
  [waiveMilestone.name]: waiveMilestone,
  [publishPaymentTerms.name]: publishPaymentTerms,
  [attachProformaPdf.name]: attachProformaPdf,
  [settleCancelledOrder.name]: settleCancelledOrder,
  [refreshMilestones.name]: refreshMilestones,
  // J1 projects
  [draftProject.name]: draftProject,
  [createProject.name]: createProject,
  [completeMilestone.name]: completeMilestone,
  [holdProject.name]: holdProject,
  [resumeProject.name]: resumeProject,
  [completeProject.name]: completeProject,
  [cancelProject.name]: cancelProject,
  [assignProject.name]: assignProject,
  [publishProjectTemplate.name]: publishProjectTemplate,
  [cancelForOrder.name]: cancelForOrder,
  // F1 field app foundation.
  [setFeatureFlag.name]: setFeatureFlag,
  [revokeMobileDevice.name]: revokeMobileDevice,
  // J2 customer loans (docs/03-roadmap-appendix/phase4.md §6.2).
  [createCustomerLoan.name]: createCustomerLoan,
  [sanctionCustomerLoan.name]: sanctionCustomerLoan,
  [disburseCustomerLoan.name]: disburseCustomerLoan,
  [rejectCustomerLoan.name]: rejectCustomerLoan,
  [waiveLoanGates.name]: waiveLoanGates,
  [createLender.name]: createLender,
  [updateLender.name]: updateLender,
} as const satisfies Record<string, AnyCommand>);

/**
 * Commands a test defines to exercise the runner itself (an event that fails after it is stored,
 * a timing line). Only `@shakti/domain/testing` adds one, and ESLint lets only tests import it.
 */
const testCommands = new WeakSet<AnyCommand>();

export function allowTestCommand(command: AnyCommand): void {
  testCommands.add(command);
}

/**
 * Whether `executeCommand()` may run this command: the registry's own object under its name, so a
 * command defined anywhere else, even under a registered name, never runs (audit ARCH-1).
 */
export function isRegistered(command: AnyCommand): boolean {
  return (
    (commands as Record<string, AnyCommand | undefined>)[command.name] === command ||
    testCommands.has(command)
  );
}

export function getCommand(name: string): AnyCommand {
  const command = (commands as Record<string, AnyCommand | undefined>)[name];
  if (!command) throw new DomainError('not_found', `no command named ${name}`, { command: name });
  return command;
}
