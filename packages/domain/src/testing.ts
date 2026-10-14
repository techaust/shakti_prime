/**
 * Settings the tests change and nothing else may: an import batch's time budget, clock and log
 * (`importBatchSettings`), and the commands a test defines to exercise the runner, which
 * `executeCommand()` otherwise refuses as not in the registry (`allowTestCommand`). Changed here,
 * they change every request the process serves, so ESLint lets only test files import this module
 * (`@shakti/domain/testing`).
 */
export { importBatchSettings } from './imports/batch-settings';
export { allowTestCommand } from './command/registry';
