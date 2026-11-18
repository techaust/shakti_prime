'use server';

import { executeQuery, voiceToday, type VoiceToday } from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { requestMeta, signedIn } from './support';

/** `/voice`: the person's minutes left today, as the screen shows them before a session. */
export async function readVoiceToday(): Promise<ActionResult<VoiceToday>> {
  return toResult('readVoiceToday', async () => {
    const principal = await signedIn();
    const meta = await requestMeta();
    return executeQuery(
      principal,
      { requestId: meta.requestId },
      (context) => voiceToday(context, new Date()),
      { name: 'readVoiceToday' },
    );
  });
}
