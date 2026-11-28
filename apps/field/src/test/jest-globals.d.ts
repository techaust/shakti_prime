// The Jest globals the app's tests use, typed here: the approved packages (Phase 4 design,
// question 12) include jest and jest-expo but not `@types/jest`, and `@jest/globals` is not a
// dependency the app may import. Only what the tests call is declared; React Native Testing
// Library adds its own matchers to `jest.Matchers`.
declare global {
  type TestBody = () => void | Promise<void>;

  function describe(name: string, body: () => void): void;
  function it(name: string, body: TestBody, timeout?: number): void;
  function beforeEach(body: TestBody): void;
  function afterAll(body: TestBody): void;

  function expect<T = unknown>(actual: T): jest.Matchers<void, T>;
  namespace expect {
    function objectContaining(value: object): unknown;
    function any(constructor: unknown): unknown;
  }

  namespace jest {
    // Type parameters as React Native Testing Library declares them, so the two merge.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- `{}` is the default RNTL's declaration of this interface gives, and merged declarations must match
    interface Matchers<R, T = {}> {
      not: Matchers<R, T>;
      toBe(expected: unknown): R;
      toEqual(expected: unknown): R;
      toBeNull(): R;
      toBeUndefined(): R;
      toBeTruthy(): R;
      toBeGreaterThan(expected: number): R;
      toMatch(expected: RegExp | string): R;
      toContain(expected: unknown): R;
      toMatchObject(expected: object): R;
      toHaveBeenCalled(): R;
      toHaveBeenCalledTimes(times: number): R;
      toHaveBeenCalledWith(...args: unknown[]): R;
    }

    interface Mock<T = unknown> {
      (...args: never[]): T;
      mock: { calls: unknown[][] };
      mockImplementation(implementation: (...args: never[]) => unknown): this;
      mockResolvedValue(value: unknown): this;
    }

    function fn<T = unknown>(implementation?: (...args: never[]) => T): Mock<T>;
    function mock(moduleName: string, factory?: () => unknown): void;
    function requireActual(moduleName: string): unknown;
    function spyOn(object: object, method: string): Mock;
    function clearAllMocks(): void;
  }
}

export {};
