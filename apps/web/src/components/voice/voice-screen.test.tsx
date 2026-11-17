import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../messages/en.json';
import { VoiceScreen } from './voice-screen';

vi.mock('../../actions/playbook', () => ({ draftDirective: vi.fn() }));

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
