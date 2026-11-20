import { BUDGET_DELAYS, measureTurnTiming, NO_DELAYS } from './turn-timing';

// The G2 voice measure (docs/03-roadmap-appendix/phase2.md §8.1 and §9.3): the worker's session on
// the fake room, first with stand-ins that answer at once (the worker's own time per step), then
// with §9.3's budget as their delays; each run's `turn_stats_json` as JSON. No vendor, model,
// LiveKit project or BOS is reached.
// Usage: pnpm --filter @shakti/voice-agent exec tsx src/measure-turns.ts [-- --turns 200]

const at = process.argv.indexOf('--turns');
const turns = at === -1 ? 200 : Number(process.argv[at + 1]);
if (!Number.isInteger(turns) || turns < 1 || turns > 10_000) {
  process.stderr.write('--turns takes a whole number from 1 to 10000\n');
  process.exit(1);
}

const instant = await measureTurnTiming({ turns, delays: NO_DELAYS });
const budget = await measureTurnTiming({ turns: Math.min(turns, 50), delays: BUDGET_DELAYS });
process.stdout.write(
  `${JSON.stringify(
    {
      at: new Date().toISOString(),
      // first_audio here covers §9.3's three vendor steps (1,100 ms of the budget's 1,500): the end
      // of speech's detection (250 ms) and the network and playback (150 ms) are not in it.
      instant: { delays: NO_DELAYS, ...instant },
      budget: { delays: BUDGET_DELAYS, ...budget },
    },
    null,
    2,
  )}\n`,
);
