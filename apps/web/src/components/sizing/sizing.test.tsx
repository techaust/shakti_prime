import { SizingDto, type PumpSizingInputs } from '@shakti/contracts';
import { SIZING_ENGINE_VERSION, sizePump, sizeRooftop } from '@shakti/domain';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../messages/en.json';
import { SizingPanel } from './sizing-panel';
import { SizingResult } from './sizing-result';

vi.mock('../../actions/sizing', () => ({ recordSizing: vi.fn(), sizingPanelData: vi.fn() }));

function render(node: ReactNode): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Kolkata">
      {node}
    </NextIntlClientProvider>,
  );
}

const LEAD = {
  id: '01990000-0000-7000-8000-00000000a001',
  entityId: 1,
  opportunityId: '01990000-0000-7000-8000-00000000a002',
  siteId: null,
  engineVersion: SIZING_ENGINE_VERSION,
  createdAt: '2026-09-30T04:30:00.000Z',
};

/** The field measurements of head worked example 1, checked on a 30 to 50 m curve of a 7.5 HP pump. */
const PUMP_INPUTS: PumpSizingInputs = {
  pumpType: 'submersible',
  drive: 'solar',
  pipeMaterial: 'hdpe',
  staticLevelM: 30,
  drawdownM: 5,
  deliveryHeightM: 2,
  pipeLengthM: 50,
  pipeInnerDiameterMm: 50,
  flowLph: 18_000,
};
const CURVE = [
  { headM: 30, flowLph: 20_000 },
  { headM: 50, flowLph: 16_000 },
];

function pumpSizing(inputs = PUMP_INPUTS): SizingDto {
  const { result, inBounds, reasons } = sizePump(inputs, { curve: CURVE, ratedHp: 7.5 });
  return SizingDto.parse({
    ...LEAD,
    kind: 'pump',
    itemId: '01990000-0000-7000-8000-00000000a003',
    inputs,
    result,
    inBounds,
    reasons,
  });
}

describe('SizingResult', () => {
  it('shows a pump sizing part by part: the head, the motor, the panels and the duty point', () => {
    const html = render(<SizingResult sizing={pumpSizing()} />);
    expect(html).toContain(en.sizing.result.inBounds);
    for (const label of [
      en.sizing.result.staticHead,
      en.sizing.result.drawdown,
      en.sizing.result.friction,
      en.sizing.result.fittings,
      en.sizing.result.total,
      en.sizing.result.standardHp,
      en.sizing.result.solarTitle,
      en.sizing.result.dutyTitle,
    ]) {
      expect(html).toContain(label);
    }
    // 30 m water plus 2 m outlet, and a total of about 44.39 m (head worked example 1).
    expect(html).toContain('32 m');
    expect(html).toContain('44.39 m');
    expect(html).toContain('7.5 HP');
    expect(html).toContain('14 panels');
    expect(html).toContain('Its curve runs from 30 m to 50 m');
    // The required flow beside the duty flow, and the band a pump must deliver within.
    expect(html).toContain(en.sizing.result.requiredFlow);
    expect(html).toContain('18,000 litres an hour');
    expect(html).toContain('It should give from 16,200 litres an hour to 27,000 litres an hour');
    expect(html).toContain(en.sizing.result.ratedHp);
    expect(html).toMatch(/<time dateTime="2026-09-30T04:30:00.000Z">/);
  });

  it('names why a result is outside its limits in plain words, never as a code', () => {
    const html = render(<SizingResult sizing={pumpSizing({ ...PUMP_INPUTS, staticLevelM: 60 })} />);
    expect(html).toContain(en.sizing.result.outOfBounds);
    expect(html).toContain(en.sizing.reason.head_above_curve.replaceAll("'", '&#x27;'));
    expect(html).not.toContain('head_above_curve');
  });

  it('shows a surface pump’s suction lift against its limit, and says when the water is too deep', () => {
    const surface = { ...PUMP_INPUTS, pumpType: 'surface' as const, staticLevelM: 10 };
    const { result, inBounds, reasons } = sizePump(surface, null);
    const html = render(
      <SizingResult
        sizing={SizingDto.parse({
          ...LEAD,
          kind: 'pump',
          itemId: null,
          inputs: surface,
          result,
          inBounds,
          reasons,
        })}
      />,
    );
    expect(html).toContain(en.sizing.result.suctionLift);
    expect(html).toContain('15 m');
    expect(html).toContain('A surface pump can draw from at most 7 m');
    expect(html).toContain(en.sizing.reason.suction_lift_exceeded);
    expect(html).not.toContain('suction_lift_exceeded');
    // A submersible has no suction lift to show.
    expect(render(<SizingResult sizing={pumpSizing()} />)).not.toContain(
      en.sizing.result.suctionLift,
    );
  });

  it('shows a rooftop sizing with the limit that set it', () => {
    const inputs = { monthlyUnitsKwh: 900, roofAreaSqm: 45, sanctionedLoadKw: 10 };
    const { result, inBounds, reasons } = sizeRooftop(inputs);
    const sizing = SizingDto.parse({
      ...LEAD,
      kind: 'rooftop',
      itemId: null,
      inputs,
      result,
      inBounds,
      reasons,
    });
    const html = render(<SizingResult sizing={sizing} />);
    expect(html).toContain(en.sizing.result.recommendedKwp);
    expect(html).toContain(en.sizing.result.boundBy.roof);
    expect(html).toContain('8 panels');
    expect(html).not.toContain(en.sizing.result.dutyTitle);
  });
});

describe('SizingPanel', () => {
  it('opens on the pump tab with the tabs in one row and the latest sizing loading', () => {
    const html = render(<SizingPanel entityId={1} opportunityId={LEAD.opportunityId} canWrite />);
    expect(html).toContain(`role="tablist" aria-label="${en.sizing.tabsLabel}"`);
    expect(html.match(/role="tab"/g)).toHaveLength(2);
    expect(html).toMatch(/aria-selected="true" [^>]*tabindex="0"[^>]*>Pump</);
    expect(html).toMatch(/aria-selected="false" [^>]*tabindex="-1"[^>]*>Rooftop solar</);
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain(`aria-label="${en.sizing.loading}"`);
  });
});
