'use server';

// Admin › Team members › Phones (F1, docs/03-roadmap-appendix/phase4.md §6.4): a person's phones
// signed in to the field app, and signing one out (`field.device.revoke`).

import {
  RevokeMobileDeviceInput,
  type MobileDeviceListDto,
  type RevokedMobileDeviceDto,
} from '@shakti/contracts';
import {
  executeCommand,
  executeQuery,
  listMobileDevices as listMobileDevicesQuery,
  revokeMobileDevice as revokeMobileDeviceCommand,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

/** One person's phones, newest sign-in first; row security keeps them to people the caller may sign out. */
export async function listMobileDevices(
  rawInput: unknown,
): Promise<ActionResult<MobileDeviceListDto>> {
  return toResult('listMobileDevices', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { requestId },
      (context) => listMobileDevicesQuery(context, rawInput),
      { name: 'listMobileDevices' },
    );
  });
}

/** Signs one phone out of the field app; its next call is refused. */
export async function revokeMobileDevice(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<RevokedMobileDeviceDto>> {
  return toResult('revokeMobileDevice', async () => {
    const principal = await signedIn();
    const input = parseInput(RevokeMobileDeviceInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      revokeMobileDeviceCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}
