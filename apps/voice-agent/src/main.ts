import { fileURLToPath } from 'node:url';
import { AutoSubscribe, cli, defineAgent, ServerOptions, type JobContext } from '@livekit/agents';
import { VOICE_AGENT_NAME, VoiceDispatchMetadata } from '@shakti/contracts';
import {
  claudeReplyModel,
  sarvamStreamingStt,
  sarvamStreamingTts,
  systemClock,
} from '@shakti/voice';
import { BosClient } from './bos-client';
import { workerConfig } from './config';
import { liveKitRoom } from './livekit-room';
import { askResponder, teachResponder } from './responders';
import { VoiceSession } from './session';
import { WavRecorder } from './wav-recorder';

/** The language the speech service hears and speaks: Hinglish and Indian English (ADR 0014). */
export const LANGUAGE_CODE = 'hi-IN';

/**
 * The voice worker (docs/03-roadmap-appendix/phase2.md §7.5, BLUEPRINT §5): LiveKit dispatches it
 * by name into each session's room, handing it the BOS's dispatch metadata; it answers the person
 * there until the session ends. Its log lines carry ids and codes only, never words or audio.
 */
export default defineAgent({
  entry: async (ctx: JobContext) => {
    const metadata = VoiceDispatchMetadata.parse(JSON.parse(ctx.job.metadata));
    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);
    // The room is named after its session; any other room is not one the BOS made.
    if (ctx.room.name !== metadata.sessionId) {
      await ctx.room.disconnect();
      return;
    }
    const room = liveKitRoom(ctx.room);
    const config = workerConfig(metadata.model);
    const log = (event: string, fields: Record<string, unknown>) => {
      console.warn(JSON.stringify({ event, sessionId: metadata.sessionId, ...fields }));
    };
    // The BOS refusing the token ends the session, which is made just below.
    const ending: { session?: VoiceSession } = {};
    const bos = new BosClient(metadata.apiBase, metadata.bosToken, () => {
      void ending.session?.end('ended');
    });
    const responder =
      metadata.mode === 'ask'
        ? askResponder((question, signal) => bos.ask(question, signal))
        : config.claude === undefined
          ? askResponder(() => Promise.reject(new Error('the reply model is not set up')))
          : teachResponder(
              claudeReplyModel(config.claude),
              config.drafting === undefined ? undefined : claudeReplyModel(config.drafting),
            );
    const session = new VoiceSession({
      room,
      metadata,
      bos,
      responder,
      stt: config.sarvam === undefined ? undefined : sarvamStreamingStt(config.sarvam),
      tts: config.sarvam === undefined ? undefined : sarvamStreamingTts(config.sarvam),
      clock: systemClock,
      wallNow: () => Date.now(),
      timers: {
        set: (fn, ms) => setTimeout(fn, ms),
        clear: (timer) => {
          clearTimeout(timer as ReturnType<typeof setTimeout>);
        },
      },
      languageCode: LANGUAGE_CODE,
      ...(metadata.mode === 'teach' && metadata.consentRecording
        ? { recorder: new WavRecorder() }
        : {}),
      log,
    });
    ending.session = session;
    bos.start();
    await session.run();
  },
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cli.runApp(
    new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: VOICE_AGENT_NAME }),
  );
}
