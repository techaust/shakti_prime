// The deterministic tax engine (ADR 0007). Pure functions: callers load the rows and pass them in.
export { effectiveOn, resolveRate } from './resolve-rate';
export type { RateQuery } from './resolve-rate';
export { placeOfSupply } from './place-of-supply';
export type { SupplyParties } from './place-of-supply';
export { compositeSplit, resolveCompositeRule } from './composite';
export type { CompositeParts, CompositeQuery } from './composite';
export { computeLine } from './compute-line';
export type { LineInput } from './compute-line';
export { computeDocument } from './compute-document';
