'use server';

import { SetThemeInput } from '@shakti/contracts';
import { executeCommand, setTheme as setThemeCommand } from '@shakti/domain';
import { currentPrincipal, forgetPrincipal } from '../auth/current-principal';
import { errorKey, toDomainError } from '../auth/errors';
import type { FormState } from './auth';
import { commandOptions, parseInput, requestMeta } from './support';

/**
 * Saves System, Light or Dark on the caller's profile (DESIGN.md §7). The screen has already
 * switched; this keeps the choice for every device. Returns a catalogue key instead of throwing,
 * because Next.js masks thrown errors in production.
 */
export async function saveTheme(rawInput: unknown): Promise<FormState> {
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
      commandOptions(meta),
    );
    await forgetPrincipal(principal.id);
    return {};
  } catch (e) {
    return { error: errorKey(toDomainError(e)) };
  }
}
