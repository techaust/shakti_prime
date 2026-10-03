// The deterministic sizing engine (docs/design/phase1.md §6.7, ARCHITECTURE §5). Pure functions:
// callers load the pump curve and pass it in; no LLM does this math (BLUEPRINT §3).
export { bounded, KW_PER_HP } from './bounds';
export type { Bounded } from './bounds';
export { hazenWilliamsLossM, totalDynamicHead } from './head';
export type { HeadInput, HeadResult } from './head';
export { nextStandardHp, pumpPower } from './power';
export type { PowerInput, PowerResult } from './power';
export { solarArrayForPump } from './solar-pump';
export type { SolarPumpInput, SolarPumpResult } from './solar-pump';
export { rooftopSize } from './rooftop';
export type { RooftopInput, RooftopResult } from './rooftop';
export { pumpDutyPoint } from './duty-point';
export type { CurvePoint, DutyPointResult } from './duty-point';
export { dcrRule, sanctionedLoadRule } from './rules';
export type { DcrRuleInput, DcrRuleResult, ModuleLine, SanctionedLoadInput } from './rules';
export { pumpMatch } from './match';
export { quoteSizingFacts } from './quote-facts';
export type { QuoteSizingContext, QuoteSizingFacts } from './quote-facts';
export type { PumpMatchInput, PumpMatchResult } from './match';
export { suctionLift } from './suction';
export type { SuctionInput, SuctionResult } from './suction';
export { pumpSpecsOf } from './pump-specs';
export type { PumpSpecs } from './pump-specs';
export { SIZING_ENGINE_VERSION, sizePump, sizeRooftop } from './size';
export type { ChosenPump } from './size';
