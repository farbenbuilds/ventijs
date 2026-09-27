import { expect, test } from "vitest";
import { target } from "./emitter-support";

test("registration methods return the emitter for chaining", () => {
  const { emitter, self } = target();
  const handler = (): void => {};
  expect(emitter.on("open", handler)).toBe(self);
  expect(emitter.addListener("open", handler)).toBe(self);
  expect(emitter.once("open", handler)).toBe(self);
  expect(emitter.prependListener("open", handler)).toBe(self);
  expect(emitter.prependOnceListener("open", handler)).toBe(self);
  expect(emitter.off("open", handler)).toBe(self);
  expect(emitter.removeListener("open", handler)).toBe(self);
  expect(emitter.removeAllListeners("open")).toBe(self);
  expect(emitter.setMaxListeners(4)).toBe(self);
});

/// `ws` delegates to `EventEmitter`, whose `setMaxListeners` runs Node's
/// `validateNumber(n, 'n', 0)`. An absent argument is a `TypeError` upstream, so
/// accepting it as `Infinity` here would be a silent divergence on a documented
/// rejection.
test("setMaxListeners refuses a non-number the way Node does", () => {
  const { emitter } = target();
  expect(() => emitter.setMaxListeners(undefined as never)).toThrow(TypeError);
  expect(() => emitter.setMaxListeners("4" as never)).toThrow(TypeError);
});

/// Node accepts a fractional limit; only a non-number, a negative, and `NaN` are
/// refused.
test("setMaxListeners accepts a fractional limit and refuses out-of-range ones", () => {
  const { emitter } = target();
  emitter.setMaxListeners(1.5);
  expect(emitter.getMaxListeners()).toBe(1.5);
  expect(() => emitter.setMaxListeners(-1)).toThrow(RangeError);
  expect(() => emitter.setMaxListeners(Number.NaN)).toThrow(RangeError);
});

test("unhandled non-Error values are wrapped like Node", () => {
  const { emitter } = target();
  let thrown: unknown;
  try {
    emitter.emit("error", "boom" as never);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as Error).message).toBe("Unhandled error. ('boom')");
  expect((thrown as { context?: unknown }).context).toBe("boom");
});
