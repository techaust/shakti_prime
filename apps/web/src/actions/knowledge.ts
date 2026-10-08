'use server';

import {
  AddKnowledgeFileInput,
  DomainError,
  KnowledgeFileRefInput,
  ListKnowledgeFilesInput,
  SearchKnowledgeInput,
  type KnowledgeFileDto,
  type KnowledgeFilePageDto,
  type KnowledgeSearchDto,
} from '@shakti/contracts';
import {
  addKnowledgeFile as addKnowledgeFileCommand,
  archiveKnowledgeFile as archiveKnowledgeFileCommand,
  checkPermission,
  executeCommand,
  executeQuery,
  knowledgeQueryVector,
  listKnowledgeFiles as listKnowledgeFilesQuery,
  reindexKnowledgeFile as reindexKnowledgeFileCommand,
  searchKnowledge as searchKnowledgeQuery,
} from '@shakti/domain';
import { countRequest, type CapRule } from '../auth/request-cap';
import { defaultAuthDeps } from '../auth/deps';
import { aiProvider } from '../integrations/ai';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

/*
 * The Knowledge Vault (docs/03-roadmap-appendix/phase1.md §8.4): thin wrappers (docs/06-api.md §4). Each runs with
 * the companies the caller is viewing; a vault file of the whole group is added, indexed again or
 * archived only while they view All companies.
 */

/**
 * Searches one person may make in a minute: each sends the question to the search service and
 * counts against the vault's daily limit, so a runaway screen must not spend it.
 */
const SEARCH_CAP: CapRule = { window: 60, max: 30 };

/** `/knowledge`: the vault files the caller may read, newest first; the next page after `cursor`. */
export async function listKnowledgeFiles(
  rawInput: unknown,
): Promise<ActionResult<KnowledgeFilePageDto>> {
  return toResult('listKnowledgeFiles', async () => {
    const principal = await signedIn();
    const input = parseInput(ListKnowledgeFilesInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { requestId },
      (context) => listKnowledgeFilesQuery(context, input),
      { name: 'listKnowledgeFiles' },
    );
  });
}

/**
 * The staff search: the question embedded through the provider wrapper, then the nearest passages
 * the caller may read, found on their own context. Without the search service's key the answer
 * says search is not available yet.
 */
export async function searchKnowledge(
  rawInput: unknown,
): Promise<ActionResult<KnowledgeSearchDto>> {
  return toResult('searchKnowledge', async () => {
    const principal = await signedIn();
    const input = parseInput(SearchKnowledgeInput, rawInput);
    // Before the question is counted or sent anywhere: a role without the search spends nothing.
    checkPermission(principal, 'knowledge.vault.read.staff', 'all');
    const counted = await countRequest(
      defaultAuthDeps().keyValue,
      `knowledge-search:${principal.id}`,
      SEARCH_CAP,
    );
    if (!counted.allowed) {
      throw new DomainError('rate_limited', 'too many searches', {
        retryAfter: counted.retryAfter,
      });
    }
    const vector = await knowledgeQueryVector(aiProvider(), input.query, principal.id);
    if (vector === undefined) return { available: false, hits: [] };
    const { requestId } = await requestMeta();
    const hits = await executeQuery(
      principal,
      { requestId },
      (context) => searchKnowledgeQuery(context, vector),
      { name: 'searchKnowledge' },
    );
    return { available: true, hits };
  });
}

/** Adds the caller's finished vault upload to the vault, with its title and sensitivity. */
export async function addKnowledgeFile(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<KnowledgeFileDto>> {
  return toResult('addKnowledgeFile', async () => {
    const principal = await signedIn();
    const input = parseInput(AddKnowledgeFileInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      addKnowledgeFileCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/** Sends a vault file to be read again (after a key is set, or a failure). */
export async function reindexKnowledgeFile(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<KnowledgeFileDto>> {
  return toResult('reindexKnowledgeFile', async () => {
    const principal = await signedIn();
    const input = parseInput(KnowledgeFileRefInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      reindexKnowledgeFileCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/** Takes a vault file out of search. */
export async function archiveKnowledgeFile(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<KnowledgeFileDto>> {
  return toResult('archiveKnowledgeFile', async () => {
    const principal = await signedIn();
    const input = parseInput(KnowledgeFileRefInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      archiveKnowledgeFileCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}
