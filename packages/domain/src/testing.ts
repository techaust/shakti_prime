/**
 * Settings the tests change and nothing else may: an import batch's time budget, clock and log
 * (`importBatchSettings`). Changed here, they change every request the process serves, so ESLint
 * lets only test files import this module (`@shakti/domain/testing`).
 */
export { importBatchSettings } from './imports/batch-settings';
