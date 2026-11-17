import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../messages/en.json';
import { dayMinutesLeft, VoiceScreen } from './voice-screen';

vi.mock('../../actions/playbook', () => ({ draftDirective: vi.fn() }));
vi.mock('../../actions/voice', () => ({ readVoiceToday: vi.fn() }));

function render(setUp: boolean, minutesLeft = 30): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en}>
      <VoiceScreen
        setUp={setUp}
        minutesLeft={minutesLeft}
        sessionMaxMinutes={Math.min(15, minutesLeft)}
        companies={[{ id: 1, name: 'Shakti Supreme' }]}
      />
    </NextIntlClientProvider>,
  );
}

describe('/voice before a talk', () => {
  it('says plainly when talking is not set up, and offers no start', () => {
    const html = render(false);
    expect(html).toContain(en.voice.notSetUp);
    expect(html).not.toContain(en.voice.start.startButton);
  });

  it('asks the recording question, with no answer chosen and the start held until there is one', () => {
    const html = render(true);
    expect(html).toContain(en.voice.start.recording);
    expect(html).not.toMatch(/name="record"[^>]*checked/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Start talking/s);
    expect(html).toContain('30 minutes left today');
    expect(html).toContain('A talk lasts at most 15 minutes.');
  });

  it('holds the start when no minutes are left today', () => {
    expect(render(true, 0)).toContain('No minutes left today');
  });
});

describe('/voice during a talk', () => {
  it("counts the day's minutes apart from the talk's: the day's at the start less the talk's used", () => {
    // 30 minutes left today and a 15-minute talk: at its start the day still has 30.
    expect(dayMinutesLeft({ dayMinutesAtStart: 30, talkMinutes: 15, minutesLeft: 15 })).toBe(30);
    // Three minutes in, 12 left in the talk and 27 today.
    expect(dayMinutesLeft({ dayMinutesAtStart: 30, talkMinutes: 15, minutesLeft: 12 })).toBe(27);
    // A full talk leaves 15 of the day, not none.
    expect(dayMinutesLeft({ dayMinutesAtStart: 30, talkMinutes: 15, minutesLeft: 0 })).toBe(15);
    // The last 4 minutes of the day, used up.
    expect(dayMinutesLeft({ dayMinutesAtStart: 4, talkMinutes: 4, minutesLeft: 0 })).toBe(0);
  });
});
