import {
  SizingDto,
  type PumpSizingInputs,
  type Segment,
  type StaleSizingDto,
  type SubsidyScheme,
} from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { quoteSizingFacts, type QuoteSizingContext } from './quote-facts';
import { SIZING_ENGINE_VERSION, sizePump, sizeRooftop, type ChosenPump } from './size';

// Worked example 1: a farmer's solar pump quote.
//   The lead was sized for 18,000 litres an hour against about 44.39 m and checked against pump P,
//   which delivers about 17,495 litres an hour there (within 16,200 to 27,000) and is rated 7.5 HP,
//   the sized rating: the sizing and its duty point are in bounds. A quote carrying pump P is
//   complete and on its curve; one carrying another pump Q is complete but not on the curve the
//   sizing checked, so the pump-curve guard refuses it until P is quoted or Q is sized.
//
// Worked example 2: a PM Surya Ghar rooftop quote.
//   The lead was sized at 300 units a month on 40 m² with a 5 kW sanctioned load. A quote of
//   2.7 kWp in five DCR modules meets the DCR rule and stays within 5 kW · 1.0 = 5 kWp; a quote of
//   5.4 kWp exceeds it, and a quote with one line of imported modules breaks the DCR rule.

const LEAD = {
  id: '01990000-0000-7000-8000-00000000b001',
  entityId: 1,
  opportunityId: '01990000-0000-7000-8000-00000000b002',
  siteId: null,
  engineVersion: SIZING_ENGINE_VERSION,
  createdAt: '2026-09-30T04:30:00.000Z',
};
const PUMP_P = '01990000-0000-7000-8000-00000000b003';
const PUMP_Q = '01990000-0000-7000-8000-00000000b004';

const INPUTS: PumpSizingInputs = {
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
const SUITED: ChosenPump = {
  curve: [
    { headM: 90, flowLph: 0 },
    { headM: 50, flowLph: 16_000 },
    { headM: 20, flowLph: 24_000 },
  ],
  ratedHp: 7.5,
};

function pumpSizing(
  options: { pump?: ChosenPump | null; itemId?: string | null; inputs?: PumpSizingInputs } = {},
): SizingDto {
  const pump = options.pump === undefined ? SUITED : options.pump;
  const inputs = options.inputs ?? INPUTS;
  const { result, inBounds, reasons } = sizePump(inputs, pump);
  return SizingDto.parse({
    ...LEAD,
    kind: 'pump',
    itemId: pump === null ? null : (options.itemId ?? PUMP_P),
    inputs,
    result,
    inBounds,
    reasons,
  });
}

function rooftopSizing(inputs = { monthlyUnitsKwh: 300, roofAreaSqm: 40, sanctionedLoadKw: 5 }) {
  const { result, inBounds, reasons } = sizeRooftop(inputs);
  return SizingDto.parse({
    ...LEAD,
    kind: 'rooftop',
    itemId: null,
    inputs,
    result,
    inBounds,
    reasons,
  });
}

const STALE: StaleSizingDto = {
  stale: true,
  id: LEAD.id,
  entityId: 1,
  opportunityId: LEAD.opportunityId,
  kind: 'pump',
  engineVersion: '1',
  createdAt: LEAD.createdAt,
};

const DCR_FIVE = [{ isDcr: true, quantity: 5 }];

function pumpQuote(over: Partial<QuoteSizingContext> = {}): QuoteSizingContext {
  return {
    segment: 'farmer_pumps',
    quotedPumpItemId: PUMP_P,
    moduleLines: DCR_FIVE,
    scheme: 'pm_kusum',
    systemKwp: 7.29,
    ...over,
  };
}

function rooftopQuote(over: Partial<QuoteSizingContext> = {}): QuoteSizingContext {
  return {
    segment: 'residential_rooftop',
    quotedPumpItemId: null,
    moduleLines: DCR_FIVE,
    scheme: 'pm_surya_ghar',
    systemKwp: 2.7,
    ...over,
  };
}

describe('quoteSizingFacts: worked example 1, a pump quote', () => {
  it('the quoted pump is the one the sizing checked: complete and on its curve', () => {
    const sizing = pumpSizing();
    expect(sizing.inBounds).toBe(true);
    expect(quoteSizingFacts(sizing, pumpQuote())).toEqual({
      sizingComplete: true,
      pumpCurveInBounds: true,
      dcrRuleMet: true,
    });
  });

  it('another pump on the quote is not on the curve the sizing checked', () => {
    expect(quoteSizingFacts(pumpSizing(), pumpQuote({ quotedPumpItemId: PUMP_Q }))).toMatchObject({
      sizingComplete: true,
      pumpCurveInBounds: false,
    });
  });

  it('a quote with no pump is not on any curve', () => {
    expect(
      quoteSizingFacts(pumpSizing(), pumpQuote({ quotedPumpItemId: null })).pumpCurveInBounds,
    ).toBe(false);
  });

  it('a sizing with no pump chosen has no duty point: complete, but not on a curve', () => {
    const sizing = pumpSizing({ pump: null });
    expect(quoteSizingFacts(sizing, pumpQuote())).toMatchObject({
      sizingComplete: true,
      pumpCurveInBounds: false,
    });
  });

  it('a chosen pump short of flow puts the sizing and its duty point out of bounds', () => {
    const small: ChosenPump = {
      curve: [
        { headM: 30, flowLph: 9_000 },
        { headM: 60, flowLph: 5_000 },
      ],
      ratedHp: 7.5,
    };
    const sizing = pumpSizing({ pump: small });
    expect(sizing.reasons).toEqual(['duty_flow_short']);
    expect(quoteSizingFacts(sizing, pumpQuote())).toMatchObject({
      sizingComplete: false,
      pumpCurveInBounds: false,
    });
  });

  it('a head above the pump’s curve fails both', () => {
    const sizing = pumpSizing({ inputs: { ...INPUTS, staticLevelM: 100 } });
    expect(quoteSizingFacts(sizing, pumpQuote())).toMatchObject({
      sizingComplete: false,
      pumpCurveInBounds: false,
    });
  });

  it('a pump sizing out of bounds elsewhere, with its duty point in bounds, is still not complete', () => {
    // A surface pump over 35 m of water: its curve answers at the head, but it cannot draw the
    // water up (suction_lift_exceeded), so the sizing is out of bounds while its duty point is not.
    const surface = { ...INPUTS, pumpType: 'surface' as const };
    const sizing = pumpSizing({ inputs: surface });
    expect(sizing.reasons).toEqual(['suction_lift_exceeded']);
    expect(sizing.kind === 'pump' && sizing.result.dutyPoint?.inBounds).toBe(true);
    expect(quoteSizingFacts(sizing, pumpQuote())).toMatchObject({
      sizingComplete: false,
      pumpCurveInBounds: true,
    });
  });

  it('a pump quote has no sanctioned load to check: the DCR rule alone decides', () => {
    expect(quoteSizingFacts(pumpSizing(), pumpQuote({ systemKwp: 500 })).dcrRuleMet).toBe(true);
    expect(
      quoteSizingFacts(pumpSizing(), pumpQuote({ moduleLines: [{ isDcr: false, quantity: 14 }] }))
        .dcrRuleMet,
    ).toBe(false);
  });
});

describe('quoteSizingFacts: worked example 2, a rooftop quote', () => {
  it('2.7 kWp of DCR modules on a 5 kW load meets every rule', () => {
    expect(quoteSizingFacts(rooftopSizing(), rooftopQuote())).toEqual({
      sizingComplete: true,
      pumpCurveInBounds: false,
      dcrRuleMet: true,
    });
  });

  it.each<[string, Partial<QuoteSizingContext>, boolean]>([
    ['exactly the sanctioned load', { systemKwp: 5 }, true],
    ['5.4 kWp above a 5 kW load', { systemKwp: 5.4 }, false],
    [
      'a line of imported modules',
      { moduleLines: [...DCR_FIVE, { isDcr: false, quantity: 1 }] },
      false,
    ],
    ['no modules under the scheme', { moduleLines: [] }, false],
    [
      'imported modules under no scheme',
      { scheme: 'none', moduleLines: [{ isDcr: false, quantity: 5 }] },
      true,
    ],
  ])('%s', (_label, over, met) => {
    expect(quoteSizingFacts(rooftopSizing(), rooftopQuote(over)).dcrRuleMet).toBe(met);
  });

  it('a rooftop sizing with no consumption is not complete', () => {
    const sizing = rooftopSizing({ monthlyUnitsKwh: 0, roofAreaSqm: 40, sanctionedLoadKw: 5 });
    expect(quoteSizingFacts(sizing, rooftopQuote()).sizingComplete).toBe(false);
  });
});

describe('quoteSizingFacts: no sizing, a stale one, or the wrong kind', () => {
  const SCHEMES: readonly SubsidyScheme[] = ['none', 'pm_surya_ghar', 'pm_kusum'];

  it.each<[string, SizingDto | StaleSizingDto | null]>([
    ['no sizing', null],
    ['a sizing from an older engine', STALE],
  ])('%s: never complete, never on a curve', (_label, latest) => {
    expect(quoteSizingFacts(latest, pumpQuote())).toMatchObject({
      sizingComplete: false,
      pumpCurveInBounds: false,
    });
    // A rooftop quote has no sanctioned load to check against, so it fails; a pump quote is held
    // to the DCR rule alone.
    expect(quoteSizingFacts(latest, rooftopQuote()).dcrRuleMet).toBe(false);
    expect(quoteSizingFacts(latest, pumpQuote()).dcrRuleMet).toBe(true);
  });

  it('a pump sizing does not complete a rooftop quote, nor a rooftop sizing a pump quote', () => {
    expect(quoteSizingFacts(pumpSizing(), rooftopQuote())).toMatchObject({
      sizingComplete: false,
      dcrRuleMet: false,
    });
    expect(quoteSizingFacts(rooftopSizing(), pumpQuote())).toMatchObject({
      sizingComplete: false,
      pumpCurveInBounds: false,
    });
  });

  it('a segment that needs no sizing takes any sizing in bounds as complete', () => {
    for (const segment of [
      'commercial_epc',
      'dealer_wholesale',
    ] as const satisfies readonly Segment[]) {
      expect(quoteSizingFacts(rooftopSizing(), rooftopQuote({ segment })).sizingComplete).toBe(
        true,
      );
      expect(quoteSizingFacts(pumpSizing(), pumpQuote({ segment })).sizingComplete).toBe(true);
      expect(quoteSizingFacts(null, pumpQuote({ segment })).sizingComplete).toBe(false);
    }
  });

  it('holds its rules over every segment, scheme and sizing', () => {
    const SEGMENTS: readonly Segment[] = [
      'farmer_pumps',
      'residential_rooftop',
      'commercial_epc',
      'dealer_wholesale',
    ];
    const sizings: (SizingDto | StaleSizingDto | null)[] = [
      null,
      STALE,
      pumpSizing(),
      pumpSizing({ pump: null }),
      pumpSizing({ inputs: { ...INPUTS, staticLevelM: 100 } }),
      rooftopSizing(),
      rooftopSizing({ monthlyUnitsKwh: 0, roofAreaSqm: 40, sanctionedLoadKw: 5 }),
    ];
    for (const segment of SEGMENTS) {
      for (const scheme of SCHEMES) {
        for (const latest of sizings) {
          for (const quotedPumpItemId of [PUMP_P, PUMP_Q, null]) {
            const facts = quoteSizingFacts(latest, {
              segment,
              scheme,
              quotedPumpItemId,
              moduleLines: DCR_FIVE,
              systemKwp: 2.7,
            });
            const current = latest === null || 'stale' in latest ? null : latest;
            // On a curve only for today's pump sizing checked against the quoted pump.
            if (facts.pumpCurveInBounds) {
              expect(current?.kind).toBe('pump');
              expect(current?.itemId).toBe(quotedPumpItemId);
            }
            // Complete only for today's sizing in bounds.
            if (facts.sizingComplete) expect(current?.inBounds).toBe(true);
            // A stale sizing or none is never complete.
            if (current === null) expect(facts.sizingComplete).toBe(false);
          }
        }
      }
    }
  });
});
