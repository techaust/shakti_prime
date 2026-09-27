// The LiveKit and speech spike (ROADMAP §2 week 6, docs/spikes/voice.md).
//   latency        the round trip to LiveKit's room service, then for each recording in
//                  VOICE_SPIKE_AUDIO_DIR one spoken turn: speech to text (Sarvam), the reply
//                  (Claude, streamed) and the first sentence's speech (Sarvam); p50 and p95 of each
//                  step and of the time to first audio against the 1.5 s target.
//   pronunciation  speaks every line of the Roman-Hinglish checklist into VOICE_SPIKE_OUT_DIR as
//                  WAV files, with a rating sheet for the listeners.
// It calls paid vendors with real keys, so it runs only when its variables are set, never in CI.
// Transcripts and replies are never printed: the recordings are the client's executives.
// Usage: pnpm --filter web spike:voice -- latency | pronunciation
import { newId } from '@shakti/contracts';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { claudeConfig, claudeReplyModel } from '../../src/integrations/voice/claude-stream';
import {
  FIRST_AUDIO_P50_TARGET_MS,
  runTurn,
  summarize,
  type TurnTiming,
} from '../../src/integrations/voice/latency';
import { liveKitConfig, liveKitRooms } from '../../src/integrations/voice/livekit';
import { PRONUNCIATION_CHECKLIST } from '../../src/integrations/voice/pronunciation-checklist';
import { sarvamConfig, sarvamSpeech } from '../../src/integrations/voice/sarvam';

/** The spoken-reply instruction for the spike; the real one comes with the voice agent (Phase 4). */
const SYSTEM = [
  'You are the voice assistant of the Shakti group, which sells pumps, solar systems and',
  'agricultural equipment in India. The person speaking is a Shakti executive.',
  'Reply in one or two short spoken sentences in Roman-script Hinglish, the way a helpful',
  'colleague talks on the phone. No lists, no symbols, no markdown.',
].join(' ');

if (process.env.CI !== undefined && process.env.CI !== '') {
  console.error('the voice spike calls paid vendors and never runs in CI');
  process.exit(1);
}

const mode = process.argv.slice(2).find((a) => a === 'latency' || a === 'pronunciation');
const language = process.env.VOICE_SPIKE_LANGUAGE ?? 'hi-IN';
const sarvam = sarvamConfig();

if (mode === 'pronunciation') {
  const outDir = process.env.VOICE_SPIKE_OUT_DIR ?? '';
  if (sarvam === undefined || outDir === '') {
    console.error('set SARVAM_API_KEY and VOICE_SPIKE_OUT_DIR first (docs/spikes/voice.md)');
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });
  const speech = sarvamSpeech(sarvam);
  const rows: string[] = [];
  const times: number[] = [];
  for (const line of PRONUNCIATION_CHECKLIST) {
    const spoken = await speech.synthesize(line.text, { languageCode: language });
    writeFileSync(join(outDir, `${line.id}.wav`), spoken.audio);
    times.push(spoken.ms);
    rows.push(`| ${line.id} | ${line.text} | ${line.listenFor} | | |`);
    console.error(`spoke ${line.id} in ${spoken.ms.toFixed(0)} ms`);
  }
  writeFileSync(
    join(outDir, 'rating-sheet.md'),
    [
      `# Pronunciation rating: ${sarvam.ttsModel}, speaker ${sarvam.speaker}, ${language}`,
      '',
      'Play each file and rate it 1 (wrong or unclear) to 5 (natural). A line passes at 4 or 5.',
      '',
      '| File | Line | Listen for | Rating | Notes |',
      '|---|---|---|---|---|',
      ...rows,
      '',
    ].join('\n'),
  );
  process.stdout.write(`${JSON.stringify({ speech: summarize(times), outDir }, null, 2)}\n`);
} else if (mode === 'latency') {
  const claude = claudeConfig();
  const livekit = liveKitConfig();
  const audioDir = process.env.VOICE_SPIKE_AUDIO_DIR ?? '';
  if (sarvam === undefined || claude === undefined || livekit === undefined || audioDir === '') {
    console.error(
      'set SARVAM_API_KEY, ANTHROPIC_API_KEY, LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET and VOICE_SPIKE_AUDIO_DIR first (docs/spikes/voice.md)',
    );
    process.exit(1);
  }
  const rounds = Number(process.env.VOICE_SPIKE_ROUNDS ?? '20');

  // LiveKit: the round trip from here to the project's region, through its room service.
  const rooms = liveKitRooms(livekit);
  const listMs: number[] = [];
  const createMs: number[] = [];
  for (let i = 0; i < Math.min(rounds, 10); i += 1) {
    listMs.push((await rooms.listRooms()).ms);
    const name = `bos-spike-${newId()}`;
    createMs.push((await rooms.createRoom(name)).ms);
    await rooms.deleteRoom(name);
  }

  // Spoken turns over the recordings.
  const files = readdirSync(audioDir)
    .filter((f) => f.toLowerCase().endsWith('.wav'))
    .sort()
    .slice(0, rounds);
  if (files.length === 0) {
    console.error(`no .wav recordings in ${audioDir}`);
    process.exit(1);
  }
  const speech = sarvamSpeech(sarvam);
  const llm = claudeReplyModel(claude);
  const timings: TurnTiming[] = [];
  for (const file of files) {
    const audio = readFileSync(join(audioDir, file));
    const turn = await runTurn(
      audio,
      { mimeType: 'audio/wav', languageCode: language, system: SYSTEM },
      { stt: speech, llm, tts: speech },
    );
    timings.push(turn.timing);
    console.error(
      `${file}: first audio ${turn.timing.firstAudioMs.toFixed(0)} ms (speech to text ${turn.timing.sttMs.toFixed(0)}, first sentence ${turn.timing.llmFirstSentenceMs.toFixed(0)}, its speech ${turn.timing.ttsFirstSentenceMs.toFixed(0)})`,
    );
  }
  const pick = (key: keyof TurnTiming) => summarize(timings.map((t) => t[key]));
  const firstAudio = pick('firstAudioMs');
  const report = {
    at: new Date().toISOString(),
    vendors: {
      stt: `sarvam ${sarvam.sttModel}`,
      llm: llm.vendor,
      tts: `sarvam ${sarvam.ttsModel}`,
    },
    language,
    livekit: { listRooms: summarize(listMs), createRoom: summarize(createMs) },
    turns: {
      sttMs: pick('sttMs'),
      llmFirstTokenMs: pick('llmFirstTokenMs'),
      llmFirstSentenceMs: pick('llmFirstSentenceMs'),
      llmTotalMs: pick('llmTotalMs'),
      ttsFirstSentenceMs: pick('ttsFirstSentenceMs'),
      firstAudioMs: firstAudio,
      sequentialMs: pick('sequentialMs'),
    },
    target: {
      firstAudioP50Ms: FIRST_AUDIO_P50_TARGET_MS,
      met: firstAudio.p50 < FIRST_AUDIO_P50_TARGET_MS,
    },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  console.error('say latency or pronunciation: pnpm --filter web spike:voice -- latency');
  process.exit(1);
}
