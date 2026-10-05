'use server';

import { LookupPinInput, type PinLookupDto } from '@shakti/contracts';
import { executeQuery, lookupPin as lookupPinQuery } from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { parseInput, requestMeta, signedIn } from './support';

/**
 * What the PIN code master knows of a PIN (PRD CRM-02), for the lead and site forms: the tehsil
 * and district a site with it is given, and its post-office localities to offer for the village.
 * Every signed-in person may ask; the master is shared reference data.
 */
export async function lookupPin(rawInput: unknown): Promise<ActionResult<PinLookupDto>> {
  return toResult('lookupPin', async () => {
    const principal = await signedIn();
    const input = parseInput(LookupPinInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (ctx) => lookupPinQuery(ctx, input), {
      name: 'lookupPin',
    });
  });
}
