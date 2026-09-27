import { loadVentijsAddon } from "./addon.ts";
import type { EngineEvent } from "./addon.ts";
import { DEFAULT_TARGET_HOST, DEFAULT_TARGET_PORT } from "./paths.ts";
import { echoState, pack, reply, type EchoState } from "./target-echo.ts";
import { encodeTargetReady } from "./target-record.ts";

/// `message_capacity` and `frame_capacity` from `src/engine/server/capacities.zig`.
/// They are `comptime` constants compiled into the addon, so the harness cannot
/// raise them and has to account for them in the expected case counts.
const MESSAGE_CAP = 32 * 1024;
const FINALIZE_ATTEMPTS = 6;

/// Target state is the echo state plus the two fields the shutdown sequence has
/// to observe. The engine owns the listener and reports its own progress.
type TargetState = EchoState & {
  closing: boolean;
  exited: boolean;
};

function readPort(): number {
  const raw = process.env["AUTOBAHN_TARGET_PORT"];
  if (raw === undefined) return DEFAULT_TARGET_PORT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new RangeError(`invalid AUTOBAHN_TARGET_PORT ${raw}`);
  }
  return parsed;
}

function readHost(): string {
  return process.env["AUTOBAHN_TARGET_HOST"] ?? DEFAULT_TARGET_HOST;
}

/// Announces the port the engine actually bound. The fuzzing client URL is
/// static JSON, so the runner reads this to know where the target ended up.
function announce(boundPort: number): void {
  const ready = {
    host: readHost(),
    port: boundPort,
    engine: loadVentijsAddon().engineVersion(),
    maxFrameBytes: MESSAGE_CAP,
    maxMessageBytes: MESSAGE_CAP,
    // The engine WebSocket route now has a message callback and the outbound
    // pump, so the target echoes. `probe-echo.ts` measures that from outside
    // rather than trusting this flag, and the two are updated together.
    echo: true,
    echoReason: null,
  } as const;
  process.stdout.write(`${encodeTargetReady(ready)}\n`);
}

/// Releases native resources. `finalizeServer` refuses while a dispatch is still
/// queued, and the `serverClosed` callback runs inside the drain, so the current
/// tick has to finish first.
function finalize(state: TargetState, remaining: number): void {
  if (state.exited) return;
  try {
    loadVentijsAddon().finalizeServer(state.handle);
  } catch (error) {
    if (remaining > 0) {
      setImmediate(() => {
        finalize(state, remaining - 1);
      });
      return;
    }
    process.stderr.write(`finalize failed: ${(error as Error).message}\n`);
    process.exit(1);
  }
  state.exited = true;
  process.exit(0);
}

function onServerClosed(state: TargetState): void {
  if (state.exited) return;
  setImmediate(() => {
    finalize(state, FINALIZE_ATTEMPTS);
  });
}

function requestClose(state: TargetState): void {
  if (state.closing) return;
  state.closing = true;
  loadVentijsAddon().closeServer(state.handle);
}

function onEngineError(state: TargetState): void {
  if (state.exited) return;
  state.exited = true;
  process.stderr.write("engine reported a fatal error\n");
  process.exit(1);
}

/// The event vocabulary is matched exhaustively, so a new engine event is a
/// compile-visible omission rather than a silent no-op.
function onEvent(state: TargetState, event: EngineEvent): void {
  switch (event.kind) {
    case "listening":
      announce(event.code);
      return;
    case "connectionOpen":
      state.connection = pack(event.index, event.generation);
      return;
    case "connectionMessage":
      reply(loadVentijsAddon(), state);
      return;
    case "connectionClose":
      return;
    case "engineError":
      onEngineError(state);
      return;
    case "serverClosed":
      onServerClosed(state);
      return;
  }
}

function start(): void {
  const state: TargetState = { ...echoState(), closing: false, exited: false };
  const addon = loadVentijsAddon();
  state.handle = addon.createServer(
    { host: readHost(), port: readPort(), path: "/", maxMessageBytes: MESSAGE_CAP },
    (event) => {
      onEvent(state, event);
    },
  );
  addon.listenServer(state.handle);
  process.on("SIGTERM", () => {
    requestClose(state);
  });
  process.on("SIGINT", () => {
    requestClose(state);
  });
}

try {
  start();
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
}
