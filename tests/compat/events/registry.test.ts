import { expect, test } from "vitest";
import { dispatch, unsubscribe } from "./registry-support";
import { createRegistry, listenerCount, subscribe } from "../../../src/compat/events/registry";

type TestEventMap = {
  open: [];
  error: [error: Error];
  message: [value: string, repeat: number];
};

test("dispatches payloads to every subscriber", () => {
  const seen: string[] = [];
  const registry = subscribe(createRegistry<TestEventMap>(), "message", (value, repeat) => {
    seen.push(value.repeat(repeat));
  });
  expect(dispatch(registry, "message", "ab", 3)).toBe(1);
  expect(seen).toEqual(["ababab"]);
});

test("dispatches nothing when no handler is subscribed", () => {
  expect(dispatch(createRegistry<TestEventMap>(), "open")).toBe(0);
  expect(listenerCount(createRegistry<TestEventMap>(), "open")).toBe(0);
});

test("propagates a handler exception and skips the remaining handlers", () => {
  const seen: string[] = [];
  const registry = subscribe(
    subscribe(createRegistry<TestEventMap>(), "open", () => {
      seen.push("first");
      throw new Error("boom");
    }),
    "open",
    () => {
      seen.push("second");
    },
  );
  expect(() => dispatch(registry, "open")).toThrow("boom");
  expect(seen).toEqual(["first"]);
});

test("reports zero handlers for error instead of throwing, leaving policy to the caller", () => {
  expect(dispatch(createRegistry<TestEventMap>(), "error", new Error("unhandled"))).toBe(0);
});

test("keeps duplicate handlers, matching EventEmitter", () => {
  let calls = 0;
  const handler = (): void => {
    calls += 1;
  };
  const registry = subscribe(
    subscribe(createRegistry<TestEventMap>(), "open", handler),
    "open",
    handler,
  );
  expect(dispatch(registry, "open")).toBe(2);
  expect(calls).toBe(2);
});

test("unsubscribing removes one occurrence without touching the previous registry", () => {
  const handler = (): void => {};
  const first = subscribe(createRegistry<TestEventMap>(), "open", handler);
  const registry = subscribe(first, "open", handler);
  const removed = unsubscribe(registry, "open", handler);
  expect(listenerCount(registry, "open")).toBe(2);
  expect(listenerCount(removed, "open")).toBe(1);
  expect(dispatch(removed, "open")).toBe(1);
});

test("removal drops the last occurrence, matching removeListener", () => {
  const calls: string[] = [];
  const duplicate = (): void => {
    calls.push("duplicate");
  };
  const marker = (): void => {
    calls.push("marker");
  };
  let registry = createRegistry<TestEventMap>();
  registry = subscribe(registry, "open", duplicate);
  registry = subscribe(registry, "open", marker);
  registry = subscribe(registry, "open", duplicate);
  dispatch(registry, "open");
  expect(calls).toEqual(["duplicate", "marker", "duplicate"]);

  calls.length = 0;
  dispatch(unsubscribe(registry, "open", duplicate), "open");
  expect(calls).toEqual(["duplicate", "marker"]);
});

test("dispatching iterates the array captured at call time", () => {
  const calls: string[] = [];
  let registry = createRegistry<TestEventMap>();
  const second = (): void => {
    calls.push("second");
  };
  const first = (): void => {
    calls.push("first");
    registry = unsubscribe(registry, "open", second);
  };
  registry = subscribe(registry, "open", first);
  registry = subscribe(registry, "open", second);
  dispatch(registry, "open");
  expect(calls).toEqual(["first", "second"]);
  expect(listenerCount(registry, "open")).toBe(1);
});

test("does not call handlers added during a dispatch", () => {
  const seen: string[] = [];
  let registry = createRegistry<TestEventMap>();
  registry = subscribe(registry, "open", () => {
    seen.push("first");
    registry = subscribe(registry, "open", () => {
      seen.push("late");
    });
  });
  expect(dispatch(registry, "open")).toBe(1);
  expect(seen).toEqual(["first"]);
  expect(listenerCount(registry, "open")).toBe(2);
});

test("unsubscribing an unknown handler returns the same registry", () => {
  const registry = createRegistry<TestEventMap>();
  expect(unsubscribe(registry, "open", () => {})).toBe(registry);
});
