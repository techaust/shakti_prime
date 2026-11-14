import type { CommandContext } from '../command/context';

/**
 * The event of a new lead (`crm.lead.created`), as every intake sends it: the lead form and an
 * import row (`crm.lead.create`) and a lead from an integration (`crm.lead.ingest`). A row an
 * import commits is history brought in (`imported`), which no agent triages.
 */
export function emitLeadCreated(
  ctx: Pick<CommandContext, 'emit'>,
  args: {
    entityId: number;
    opportunityId: string;
    pipelineKey: string;
    sourceCode: string | null;
    existingAccount: boolean;
    imported?: boolean;
  },
): void {
  ctx.emit({
    type: 'crm.lead.created',
    entityId: args.entityId,
    aggregateType: 'opportunity',
    aggregateId: args.opportunityId,
    payload: {
      pipelineKey: args.pipelineKey,
      sourceCode: args.sourceCode,
      existingAccount: args.existingAccount,
      ...(args.imported === true ? { imported: true as const } : {}),
    },
  });
}
