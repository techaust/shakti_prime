/**
 * Expo installs some web globals (`fetch`, `URL`, `structuredClone` and others) as enumerable lazy
 * getters that `require()` their implementation on first read. Jest 30.2's teardown reads every
 * enumerable global to clear mocks, after the test code has ended, so a getter never read by the
 * test then requires a module and Jest refuses (jest-expo 58 patches this only for Jest 30.4 and
 * later). The getters are kept, only made non-enumerable, so they stay lazy and are never touched
 * by that loop.
 */
export function hideLazyGlobals(): void {
  for (const name of Object.getOwnPropertyNames(globalThis)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    if (
      descriptor?.get !== undefined &&
      descriptor.enumerable === true &&
      descriptor.configurable === true
    ) {
      Object.defineProperty(globalThis, name, { ...descriptor, enumerable: false });
    }
  }
}
