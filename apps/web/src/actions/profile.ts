'use server';

import {
  DeleteViewInput,
  SaveViewInput,
  SetContrastInput,
  SetThemeInput,
  type ContrastDto,
  type DeletedViewDto,
  type SavedViewDto,
  type ThemeDto,
} from '@shakti/contracts';
import {
  deleteView as deleteViewCommand,
  executeCommand,
  executeQuery,
  listSavedViews as listSavedViewsQuery,
  saveView as saveViewCommand,
  setContrast as setContrastCommand,
  setTheme as setThemeCommand,
} from '@shakti/domain';
import { forgetPrincipal } from '../auth/current-principal';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

/**
 * Saves System, Light or Dark on the caller's profile (docs/08-design-system.md §7). The screen has already
 * switched; this keeps the choice for every device. It answers an `ActionResult` instead of
 * throwing, because Next.js masks thrown errors in production, and an unexpected failure is
 * logged with the reference the person reads to support.
 */
export async function saveTheme(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ThemeDto>> {
  return toResult('saveTheme', async () => {
    const principal = await signedIn();
    const input = parseInput(SetThemeInput, rawInput);
    const meta = await requestMeta();
    const saved = await executeCommand(
      principal,
      { requestId: meta.requestId },
      setThemeCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
    await forgetPrincipal(principal.id);
    return saved;
  });
}

/**
 * Saves Higher contrast on or off on the caller's profile (docs/08-design-system.md §2.1), so it follows them to
 * every device as the theme does. The screen has already switched and the cookie mirrors the
 * choice for the first paint; the cached principal is dropped so the next page reads it back.
 */
export async function saveContrast(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ContrastDto>> {
  return toResult('saveContrast', async () => {
    const principal = await signedIn();
    const input = parseInput(SetContrastInput, rawInput);
    const meta = await requestMeta();
    const saved = await executeCommand(
      principal,
      { requestId: meta.requestId },
      setContrastCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
    await forgetPrincipal(principal.id);
    return saved;
  });
}

/** The caller's own saved views of one grid, for the Views menu (docs/08-design-system.md §6). */
export async function listSavedViews(rawInput: unknown): Promise<ActionResult<SavedViewDto[]>> {
  return toResult('listSavedViews', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { requestId },
      (context) => listSavedViewsQuery(context, rawInput),
      { name: 'listSavedViews' },
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
