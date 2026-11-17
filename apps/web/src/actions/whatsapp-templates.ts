'use server';

import {
  SetWhatsAppMilestoneInput,
  type WhatsAppMilestoneDto,
  type WhatsAppTemplateSettingsDto,
} from '@shakti/contracts';
import {
  executeCommand,
  executeQuery,
  listWhatsAppTemplateSettings,
  setWhatsAppMilestone as setWhatsAppMilestoneCommand,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

/*
 * Settings › WhatsApp templates (docs/03-roadmap-appendix/phase2.md §7.1): thin wrappers
 * (docs/06-api.md §4), with the companies the caller is viewing.
 */

/** The companies' templates and their milestone maps. */
export async function loadWhatsAppTemplateSettings(): Promise<
  ActionResult<WhatsAppTemplateSettingsDto>
> {
  return toResult('loadWhatsAppTemplateSettings', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { requestId },
      (context) => listWhatsAppTemplateSettings(context),
      { name: 'loadWhatsAppTemplateSettings' },
    );
  });
}

/** Maps a customer update of a company to one of its templates, or switches it off. */
export async function setWhatsAppMilestone(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<WhatsAppMilestoneDto>> {
  return toResult('setWhatsAppMilestone', async () => {
    const principal = await signedIn();
    const input = parseInput(SetWhatsAppMilestoneInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      setWhatsAppMilestoneCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}
