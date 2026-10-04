import { DomainError } from '@shakti/contracts';
import { clearSignInLock } from '../commands/admin/clear-sign-in-lock';
import { inviteUser } from '../commands/admin/invite-user';
import { revokeSession } from '../commands/admin/revoke-session';
import { setRolePermissions } from '../commands/admin/set-role-permissions';
import { setUserRoles } from '../commands/admin/set-user-roles';
import { resetTwoFactor } from '../commands/admin/two-factor-reset';
import { reactivateUser, suspendUser } from '../commands/admin/user-status';
import { assignOpportunity } from '../commands/crm/assign-opportunity';
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
import { setCommissionRule, setReferralPartner } from '../commands/crm/referrals';
import { refreshLeadScores, rescoreLead, setScoreRules } from '../commands/crm/score-rules';
import { setDispositions } from '../commands/crm/set-dispositions';
import { reopenOpportunity } from '../commands/crm/reopen-opportunity';
import { recordConsent, withdrawConsent } from '../commands/crm/consent';
import { addNote, updateAccount, updateContact, upsertSite } from '../commands/crm/customer';
import { archiveTag, createTag, tagLead, untagLead } from '../commands/crm/tags';
import { cancelTask, completeTask, createTask, rescheduleTask } from '../commands/crm/tasks';
import { winOpportunity } from '../commands/crm/win-opportunity';
import { beginUpload } from '../commands/files/begin-upload';
import { markFileReady, markFileScanned, rejectFile } from '../commands/files/check-file';
import { completeUpload } from '../commands/files/complete-upload';
import { recheckFiles } from '../commands/files/recheck-files';
import { commitImportBatch, commitImportJob } from '../commands/imports/commit-job';
import { createImportJob } from '../commands/imports/create-job';
import { mapImportJob } from '../commands/imports/map-job';
import { previewImportJob } from '../commands/imports/preview-job';
import { rollbackImportJob } from '../commands/imports/rollback-job';
import { replayDeadLetter } from '../commands/integrations/replay-dead-letter';
import { updateEntity } from '../commands/org/update-entity';
import { archiveItem, createItem, updateItem } from '../commands/catalogue/items';
import { archiveKit, createKit, updateKit } from '../commands/catalogue/kits';
import { setPumpCurve } from '../commands/catalogue/pump-curve';
import {
  approvePriceList,
  archivePriceList,
  createPriceList,
} from '../commands/pricing/price-lists';
import { runDeliveryProbe } from '../commands/platform/run-probe';
import { setPrice } from '../commands/pricing/set-price';
import { deleteView, saveView } from '../commands/profile/saved-views';
import { setTheme } from '../commands/profile/set-theme';
import { issueRealtimeToken } from '../commands/realtime/issue-token';
import { setContrast } from '../commands/profile/set-contrast';
import { setCompositeRule } from '../commands/tax/set-composite-rule';
import { setTaxRate } from '../commands/tax/set-tax-rate';
import type { AnyCommand } from './define-command';

/** Every command the system can perform, by name. Agents, voice and imports call through here. */
export const commands = {
  [updateEntity.name]: updateEntity,
  [createLead.name]: createLead,
  [moveOpportunityStage.name]: moveOpportunityStage,
  [assignOpportunity.name]: assignOpportunity,
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
  [setCommissionRule.name]: setCommissionRule,
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
  [setPrice.name]: setPrice,
  [createPriceList.name]: createPriceList,
  [approvePriceList.name]: approvePriceList,
  [archivePriceList.name]: archivePriceList,
  [createItem.name]: createItem,
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
  [beginUpload.name]: beginUpload,
  [completeUpload.name]: completeUpload,
  [markFileScanned.name]: markFileScanned,
  [markFileReady.name]: markFileReady,
  [rejectFile.name]: rejectFile,
  [recheckFiles.name]: recheckFiles,
} as const satisfies Record<string, AnyCommand>;

export function getCommand(name: string): AnyCommand {
  const command = (commands as Record<string, AnyCommand | undefined>)[name];
  if (!command) throw new DomainError('not_found', `no command named ${name}`, { command: name });
  return command;
}
