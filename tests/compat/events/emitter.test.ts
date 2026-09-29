import { expect, test } from "vitest";
import { target } from "./emitter-support";

test("keeps duplicate handlers and dispatches them in registration order", () => {
  const { emitter } = target();
  const seen: string[] = [];
  const handler = (value: string): void => {
    seen.push(value);
  };
  emitter.on("message", handler);
  emitter.on("message", handler);
  expect(emitter.emit("message", "a", 1)).toBe(true);
  expect(seen).toEqual(["a", "a"]);
  expect(emitter.listenerCount("message")).toBe(2);
});

test("once runs a handler once and is removed before it throws", () => {
  const { emitter } = target();
  let calls = 0;
  const handler = (): void => {
    calls += 1;
    throw new Error("boom");
  };
  emitter.once("open", handler);
  expect(() => emitter.emit("open")).toThrow("boom");
  expect(emitter.emit("open")).toBe(false);
  expect(calls).toBe(1);
});

test("removeListener matches once wrappers through their original handler", () => {
  const { emitter } = target();
  let calls = 0;
  const handler = (): void => {
    calls += 1;
  };
  emitter.once("open", handler);
  expect(emitter.rawListeners("open")).toHaveLength(1);
  expect(emitter.listeners("open")[0]).toBe(handler);
  emitter.off("open", handler);
  expect(emitter.emit("open")).toBe(false);
  expect(calls).toBe(0);
});

test("prepend and prependOnceListener run before earlier handlers", () => {
  const { emitter } = target();
  const seen: string[] = [];
  emitter.on("open", () => {
    seen.push("on");
  });
  emitter.prependListener("open", () => {
    seen.push("prepend");
  });
  emitter.prependOnceListener("open", () => {
    seen.push("prependOnce");
  });
  emitter.emit("open");
  emitter.emit("open");
  expect(seen).toEqual(["prependOnce", "prepend", "on", "prepend", "on"]);
});

test("emit reports whether a handler ran and throws unhandled errors", () => {
  const { emitter } = target();
  expect(emitter.emit("open")).toBe(false);
  const failure = new Error("unhandled");
  expect(() => emitter.emit("error", failure)).toThrow(failure);
  emitter.on("error", () => {});
  expect(emitter.emit("error", failure)).toBe(true);
});

test("introspection mirrors EventEmitter", () => {
  const { emitter } = target();
  emitter.on("open", () => {});
  emitter.on("message", () => {});
  expect(emitter.eventNames()).toEqual(["open", "message"]);
  expect(emitter.listenerCount("open")).toBe(1);
  expect(emitter.getMaxListeners()).toBe(10);
  emitter.setMaxListeners(0);
  expect(emitter.getMaxListeners()).toBe(0);
  expect(() => emitter.setMaxListeners(-1)).toThrow(RangeError);
  emitter.removeAllListeners("open");
  expect(emitter.eventNames()).toEqual(["message"]);
  emitter.removeAllListeners();
  expect(emitter.eventNames()).toEqual([]);
});

test("invokes listeners with the emitter as this", () => {
  const { emitter, self } = target();
  const reads: unknown[] = [];
  const probe = new Function("value", "globalThis.__ventiwsThisProbe.push(this)") as (
    value: string,
  ) => void;
  (globalThis as Record<string, unknown>).__ventiwsThisProbe = reads;
  emitter.on("message", probe);
  emitter.emit("message", "x", 1);
  expect(reads[0]).toBe(self);
  delete (globalThis as Record<string, unknown>).__ventiwsThisProbe;
});
