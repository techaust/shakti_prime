import { hideLazyGlobals } from './lazy-globals';

// Globals a test file's imports installed lazily, hidden from Jest's teardown too.
afterAll(() => {
  hideLazyGlobals();
});
