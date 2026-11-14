'use server';

import {
  HandOffWhatsAppThreadInput,
  ReturnWhatsAppThreadInput,
  SendWhatsAppMessageInput,
  type ThreadViewDto,
  type WaitingThreadDto,
  type WaitingThreadPageDto,
  type WhatsAppMessageDto,
  type WhatsAppThreadDto,
} from '@shakti/contracts';
import {
  executeCommand,
  executeQuery,
  handOffWhatsAppThread,
  listAccountThreads as listAccountThreadsQuery,
  listWaitingThreads as listWaitingThreadsQuery,
  readWhatsAppThread,
  returnWhatsAppThread,
  sendWhatsAppMessage as sendWhatsAppMessageCommand,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

/*
 * WhatsApp chats (docs/03-roadmap-appendix/phase2.md §6.1): thin wrappers (docs/06-api.md §4). Each
 * runs with the companies the caller is viewing; a chat is read under its customer's read rule.
 */

/** `/messages`: the chats waiting for a reply that the caller may answer, newest first. */
export async function listWaitingThreads(
  rawInput: unknown,
): Promise<ActionResult<WaitingThreadPageDto>> {
  return toResult('listWaitingThreads', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { requestId },
      (context) => listWaitingThreadsQuery(context, rawInput),
      { name: 'listWaitingThreads' },
    );
  });
}

/** A customer's chats in one company (Account 360, the Converting workspace). */
export async function listAccountThreads(
  rawInput: unknown,
): Promise<ActionResult<WaitingThreadDto[]>> {
  return toResult('listAccountThreads', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { requestId },
      (context) => listAccountThreadsQuery(context, rawInput),
      { name: 'listAccountThreads' },
    );
  });
}

/** One chat with a page of its messages, its holders when unmatched and the templates to send. */
export async function loadThread(rawInput: unknown): Promise<ActionResult<ThreadViewDto>> {
  return toResult('loadThread', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { requestId },
      (context) => readWhatsAppThread(context, rawInput),
      { name: 'loadThread' },
    );
  });
}

/** A message on a chat: text in the window, or an approved template with its values. */
export async function sendWhatsAppMessage(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<WhatsAppMessageDto>> {
  return toResult('sendWhatsAppMessage', async () => {
    const principal = await signedIn();
    const input = parseInput(SendWhatsAppMessageInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      sendWhatsAppMessageCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/** The caller takes a chat over from the assistant. */
export async function takeOverThread(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<WhatsAppThreadDto>> {
  return toResult('takeOverThread', async () => {
    const principal = await signedIn();
    const input = parseInput(HandOffWhatsAppThreadInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      handOffWhatsAppThread,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/** The caller gives a chat back to the assistant. */
export async function returnThread(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<WhatsAppThreadDto>> {
  return toResult('returnThread', async () => {
    const principal = await signedIn();
    const input = parseInput(ReturnWhatsAppThreadInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      returnWhatsAppThread,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}
