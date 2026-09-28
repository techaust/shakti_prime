'use server';

import {
  DeleteViewInput,
  SaveViewInput,
  SetThemeInput,
  type DeletedViewDto,
  type SavedViewDto,
} from '@shakti/contracts';
import {
  deleteView as deleteViewCommand,
  executeCommand,
  executeQuery,
  listSavedViews as listSavedViewsQuery,
  saveView as saveViewCommand,
  setTheme as setThemeCommand,
} from '@shakti/domain';
import { currentPrincipal, forgetPrincipal } from '../auth/current-principal';
import { errorKey, toDomainError } from '../auth/errors';
import type { FormState } from './auth';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

/**
 * Saves System, Light or Dark on the caller's profile (DESIGN.md §7). The screen has already
 * switched; this keeps the choice for every device. Returns a catalogue key instead of throwing,
 * because Next.js masks thrown errors in production.
 */
export async function saveTheme(rawInput: unknown, idempotencyKey?: unknown): Promise<FormState> {
  try {
    const principal = await currentPrincipal();
    if (!principal) return { error: 'unauthorized' };
    const input = parseInput(SetThemeInput, rawInput);
    const meta = await requestMeta();
    await executeCommand(
      principal,
      { requestId: meta.requestId },
      setThemeCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
    await forgetPrincipal(principal.id);
    return {};
  } catch (e) {
    return { error: errorKey(toDomainError(e)) };
  }
}

/** The caller's own saved views of one grid, for the Views menu (DESIGN.md §6). */
export async function listSavedViews(rawInput: unknown): Promise<ActionResult<SavedViewDto[]>> {
  return toResult('listSavedViews', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) =>
      listSavedViewsQuery(context, rawInput),
    );
  });
}

/** Saves the grid as a new view, or renames or updates one of the caller's own views. */
export async function saveView(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<SavedViewDto>> {
  return toResult('saveView', async () => {
    const principal = await signedIn();
    const input = parseInput(SaveViewInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      saveViewCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/** Removes one of the caller's own saved views. */
export async function deleteView(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<DeletedViewDto>> {
  return toResult('deleteView', async () => {
    const principal = await signedIn();
    const input = parseInput(DeleteViewInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      deleteViewCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}
