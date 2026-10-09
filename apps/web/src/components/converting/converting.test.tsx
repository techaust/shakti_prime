import type { ConvertingBoardDto, ConvertingLeadDto, NextActionDto } from '@shakti/contracts';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import en from '../../../messages/en.json';
import { KeysHelp } from './keys-help';
import { NextActions, StageBoard } from './lead-board';

function render(node: ReactNode): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Kolkata">
      {node}
    </NextIntlClientProvider>,
  );
}

const ID = '01990000-0000-7000-8000-00000000c001';
const NOW = '2030-03-05T10:00:00.000Z';

function lead(over: Partial<ConvertingLeadDto> = {}): ConvertingLeadDto {
  return {
    opportunityId: ID,
    entityId: 1,
    accountId: '01990000-0000-7000-8000-00000000c002',
    customerName: 'Dhanna Ram Bairwa',
    village: 'Sanganer',
    segment: 'residential_rooftop',
    pipelineName: 'Residential Rooftop',
    stageId: '01990000-0000-7000-8000-00000000c003',
    stageKey: 'qualified',
    stageName: 'Qualified',
    stagePosition: 3,
    needsQuote: true,
    state: 'open',
    score: 40,
    stageSince: NOW,
    nextCall: null,
    sizing: 'none',
    size: null,
    quote: null,
    heldOrder: null,
    ...over,
  };
}

const board = (leads: ConvertingLeadDto[], actions: NextActionDto[] = []): ConvertingBoardDto => ({
  asOf: NOW,
  leads,
  actions,
  truncated: false,
});

describe('NextActions', () => {
  it('says there is nothing to do when no rule is met', () => {
    expect(render(<NextActions actions={[]} onOpen={() => undefined} />)).toContain(
      en.converting.next.empty,
    );
  });

  it('words every rule from the catalogue, with the time of the ones that have one', () => {
    const action = (rule: NextActionDto['rule'], at: string | null): NextActionDto => ({
      opportunityId: ID,
      entityId: 1,
      customerName: 'Dhanna Ram Bairwa',
      rule,
      panel: 'calls',
      at,
    });
    const html = render(
      <NextActions
        actions={[
          action('callback_due', NOW),
          action('quote_expiring', NOW),
          action('order_held', NOW),
          action('sizing_missing', null),
        ]}
        onOpen={() => undefined}
      />,
    );
    for (const sentence of Object.values(en.converting.next.rule)) {
      expect(html).toContain(sentence);
    }
    // The three with a time show it as a time; the missing sizing shows none.
    expect(html.match(/<time /g)).toHaveLength(3);
  });
});

describe('StageBoard', () => {
  const buttons = { current: new Map<string, HTMLButtonElement>() };
  const view = (b: ConvertingBoardDto, current?: string) =>
    render(
      <StageBoard
        board={b}
        current={current}
        buttons={buttons}
        pending={false}
        onOpen={() => undefined}
        onRefresh={() => undefined}
      />,
    );

  it('shows each lead in the column of its stage, the open one marked', () => {
    const html = view(
      board([
        lead(),
        lead({
          opportunityId: '01990000-0000-7000-8000-00000000c004',
          customerName: 'Hari Singh Shekhawat',
          stageKey: 'quoted',
          stageName: 'Quoted',
          stagePosition: 4,
          quote: {
            id: ID,
            quoteNo: 'SS/Q/2030/0001',
            state: 'sent',
            validUntil: NOW,
            grandTotal: '1.00',
          },
        }),
      ]),
      ID,
    );
    expect(html).toContain('Qualified · 1');
    expect(html).toContain('Quoted · 1');
    expect(html.indexOf('Qualified · 1')).toBeLessThan(html.indexOf('Quoted · 1'));
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toContain(en.quotes.state.sent);
  });

  it('says what a lead needs: not sized, a call due, an order held, or its size', () => {
    const html = view(
      board([
        lead({ nextCall: { kind: 'callback', dueAt: NOW } }),
        lead({
          opportunityId: '01990000-0000-7000-8000-00000000c005',
          customerName: 'Bhanwari Devi Choudhary',
          sizing: 'current',
          size: { kind: 'rooftop', hp: null, kwp: 3 },
          heldOrder: { id: ID, soNo: 'SO/1', heldAt: NOW, grandTotal: '5.00' },
        }),
      ]),
    );
    expect(html).toContain(en.converting.board.notSized);
    expect(html).toContain(en.converting.board.callDue);
    expect(html).toContain(en.converting.board.orderHeld);
    expect(html).toContain('3 kWp');
  });

  it('does not ask a dealer lead for a sizing, and tells an empty board how leads arrive', () => {
    expect(view(board([lead({ segment: 'dealer_wholesale' })]))).not.toContain(
      en.converting.board.notSized,
    );
    expect(view(board([]))).toContain(en.converting.board.empty);
  });
});

describe('KeysHelp', () => {
  it('lists every key of the workspace and opens only when asked', () => {
    const closed = render(<KeysHelp open={false} onToggle={() => undefined} />);
    expect(closed).not.toContain('<details open');
    const open = render(<KeysHelp open onToggle={() => undefined} />);
    expect(open).toContain('<details open');
    for (const sentence of Object.values(en.converting.keys.what)) {
      expect(open).toContain(sentence);
    }
  });
});
