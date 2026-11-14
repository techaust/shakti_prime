'use server';

import {
  DeleteAskConversationInput,
  type AskConversationDetailDto,
  type AskConversationPageDto,
  type DeletedAskConversationDto,
} from '@shakti/contracts';
import {
  deleteAskConversation as deleteAskConversationCommand,
  executeCommand,
  executeQuery,
  listAskConversations as listAskConversationsQuery,
  readAskConversation as readAskConversationQuery,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

/*
 * Ask the Business (docs/03-roadmap-appendix/phase2.md §6.5): the person's own conversations, read
 * and deleted here; a question itself goes to `POST /api/v1/ask`, which streams its answer.
 */

/** `/ask`: the caller's conversations in the companies they view, last used first. */
export async function listAskConversations(
  rawInput: unknown,
): Promise<ActionResult<AskConversationPageDto>> {
  return toResult('listAskConversations', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { requestId },
      (context) => listAskConversationsQuery(context, rawInput),
      { name: 'listAskConversations' },
    );
  });
}

/** `/ask`: one of the caller's conversations with its questions, answers and cited records. */
export async function readAskConversation(
  rawInput: unknown,
): Promise<ActionResult<AskConversationDetailDto>> {
  return toResult('readAskConversation', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { requestId },
      (context) => readAskConversationQuery(context, rawInput),
      { name: 'readAskConversation' },
    );
  });
}

/** Deletes one of the caller's conversations with its questions and answers. */
export async function deleteAskConversation(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<DeletedAskConversationDto>> {
  return toResult('deleteAskConversation', async () => {
    const principal = await signedIn();
    const input = parseInput(DeleteAskConversationInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      deleteAskConversationCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}
