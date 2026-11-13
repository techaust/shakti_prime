'use server';

import {
  DomainError,
  DraftFromFileRequest,
  DraftPlaybookDirectiveInput,
  EditPlaybookDirectiveInput,
  PlaybookDirectiveRefInput,
  ResolvePlaybookConflictInput,
  RetirePlaybookDirectiveInput,
  type PlaybookConflictCheckDto,
  type PlaybookDirectiveDto,
  type PlaybookDraftsDto,
  type PlaybookPageDto,
  type PlaybookReviewDto,
} from '@shakti/contracts';
import {
  AGENT_DEFAULTS,
  approvePlaybookDirective,
  checkPermission,
  draftPlaybookDirective,
  draftPlaybookFromFile,
  editPlaybookDirective,
  executeCommand,
  executeQuery,
  listPlaybook as listPlaybookQuery,
  loadPlaybookReview as loadPlaybookReviewQuery,
  playbookSourcePassages,
  proposeDirectives,
  resolvePlaybookConflict,
  retirePlaybookDirective,
} from '@shakti/domain';
import { countRequest, type CapRule } from '../auth/request-cap';
import { defaultAuthDeps } from '../auth/deps';
import { aiProvider } from '../integrations/ai';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

/*
 * The Business Playbook (docs/03-roadmap-appendix/phase2.md §5.4): thin wrappers (docs/06-api.md
 * §4). Each runs with the companies the caller is viewing; a directive of the whole group is
 * drafted or changed only while they view All companies.
 */

/**
 * Drafting runs a model over a whole vault file: a person may start it a few times a minute, so a
 * screen clicked again and again cannot spend the day's limit.
 */
const DRAFT_CAP: CapRule = { window: 60, max: 3 };

/** `/knowledge/playbook`: the directives the caller may read, by state, type and company. */
export async function listPlaybook(rawInput: unknown): Promise<ActionResult<PlaybookPageDto>> {
  return toResult('listPlaybook', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { requestId },
      (context) => listPlaybookQuery(context, rawInput),
      { name: 'listPlaybook' },
    );
  });
}

/** The review sheet: the directive, its source passage and the pairs beside the other directive. */
export async function loadPlaybookReview(
  rawInput: unknown,
): Promise<ActionResult<PlaybookReviewDto>> {
  return toResult('loadPlaybookReview', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { requestId },
      (context) => loadPlaybookReviewQuery(context, rawInput),
      { name: 'loadPlaybookReview' },
    );
  });
}

/** A new draft, typed in. */
export async function draftDirective(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<PlaybookDirectiveDto>> {
  return toResult('draftDirective', async () => {
    const principal = await signedIn();
    const input = parseInput(DraftPlaybookDirectiveInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      draftPlaybookDirective,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/** A draft's new wording, type and audience. */
export async function editDirective(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<PlaybookDirectiveDto>> {
  return toResult('editDirective', async () => {
    const principal = await signedIn();
    const input = parseInput(EditPlaybookDirectiveInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      editPlaybookDirective,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/** Approves a draft; refused while its check runs or a clash is open. */
export async function approveDirective(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<PlaybookDirectiveDto>> {
  return toResult('approveDirective', async () => {
    const principal = await signedIn();
    const input = parseInput(PlaybookDirectiveRefInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      approvePlaybookDirective,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/** Retires a draft or an approved directive, with the reason. */
export async function retireDirective(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<PlaybookDirectiveDto>> {
  return toResult('retireDirective', async () => {
    const principal = await signedIn();
    const input = parseInput(RetirePlaybookDirectiveInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      retirePlaybookDirective,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/** Settles a clash: not a clash, with a note, or by retiring the other directive. */
export async function resolveConflict(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<PlaybookConflictCheckDto>> {
  return toResult('resolveConflict', async () => {
    const principal = await signedIn();
    const input = parseInput(ResolvePlaybookConflictInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      resolvePlaybookConflict,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/**
 * Draft directives on a vault file: its passages read as the caller, the drafting model's
 * proposals filtered, then the drafts written in one transaction. No draft is an answer too: the
 * file states no rule the model could cite.
 */
export async function draftFromVaultFile(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<PlaybookDraftsDto>> {
  return toResult('draftFromVaultFile', async () => {
    const principal = await signedIn();
    const input = parseInput(DraftFromFileRequest, rawInput);
    // Before anything is counted or sent: a role that may not draft spends nothing.
    checkPermission(principal, 'knowledge.playbook.draft', 'all');
    const counted = await countRequest(
      defaultAuthDeps().keyValue,
      `playbook-draft:${principal.id}`,
      DRAFT_CAP,
    );
    if (!counted.allowed) {
      throw new DomainError('rate_limited', 'too many drafting runs', {
        retryAfter: counted.retryAfter,
      });
    }
    const meta = await requestMeta();
    const source = await executeQuery(
      principal,
      { requestId: meta.requestId },
      (context) =>
        playbookSourcePassages(
          context,
          input.knowledgeFileId,
          AGENT_DEFAULTS.playbook.passagesPerDraft,
        ),
      { name: 'draftFromVaultFile' },
    );
    if (source === undefined) {
      throw new DomainError('not_found', 'the vault file is not usable', {
        reason: 'playbook_source_missing',
      });
    }
    const drafts = await proposeDirectives(aiProvider(), source, principal.id);
    if (drafts.length === 0) return { drafts: [] };
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      draftPlaybookFromFile,
      { ...input, drafts },
      commandOptions(meta, idempotencyKey),
    );
  });
}
