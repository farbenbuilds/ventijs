import { createEmitter } from "../../../src/compat/events/emitter";
import { createRegistry } from "../../../src/compat/events/registry";
import type { EmitterState } from "../../../src/types/events";

export type TestEventMap = {
  open: [];
  message: [value: string, repeat: number];
  error: [error: Error];
};

export function target(): {
  readonly state: EmitterState<TestEventMap>;
  readonly emitter: ReturnType<typeof createEmitter<TestEventMap>>;
  readonly self: object;
} {
  const state: EmitterState<TestEventMap> = {
    listeners: createRegistry<TestEventMap>(),
    maxListeners: 10,
    warned: new Set<string>(),
    target: undefined,
  };
  const emitter = createEmitter(state);
  const self = { emitter };
  state.target = self;
  return { state, emitter, self };
}
