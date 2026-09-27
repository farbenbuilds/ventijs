import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { VentiAddon } from "../../src/binding/native.ts";
import type { EchoServer, EchoServerOptions } from "./echo-types.ts";
import { initialState, onEngineEvent } from "./native-state.ts";

/// The bench measures the native engine, not the `ws`-shaped facade. The facade's
/// HTTP upgrade path adopts a raw Node stream and does no RFC 6455 framing yet,
/// so a facade leg would measure a handshake that never becomes a message. The
/// engine is the product, so it is the thing under test; `COMPATIBILITY.md`
/// records the split.
///
/// `src/binding` uses extensionless relative imports, which Node's type stripping
/// cannot resolve at runtime, so only the ABI declaration is reused here and it
/// is erased before execution. The addon is resolved the way
/// `src/binding/load.ts` resolves it, with the same candidate order.
const CANDIDATE_PATHS = [
  ["zig-out", "lib", "ventijs.node"],
  ["dist", "ventijs.node"],
] as const;

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FINALIZE_ATTEMPTS = 200;
const POLL_INTERVAL_MS = 5;
const require = createRequire(import.meta.url);

let addon: VentiAddon | undefined;

function loadAddon(): VentiAddon {
  if (addon !== undefined) return addon;
  for (const parts of CANDIDATE_PATHS) {
    const candidate = join(PACKAGE_ROOT, ...parts);
    if (existsSync(candidate)) {
      addon = require(candidate) as VentiAddon;
      return addon;
    }
  }
  throw new Error(
    `ventijs: native addon not found under ${PACKAGE_ROOT}; run "pnpm build:binding" first`,
  );
}

/// An echo over the native engine: the engine parses a frame, hands the payload
/// to JavaScript, the handler stages a reply, and the pump puts it on the wire.
/// That is the smallest application exercising the whole path, so it is the
/// smallest honest thing to measure.
export function nativeEchoServer(options: EchoServerOptions): EchoServer {
  const a = loadAddon();
  const state = initialState();
  state.server = a.createServer({ host: "127.0.0.1", port: options.port, path: "/" }, (event) => {
    onEngineEvent(a, state, event);
  });
  a.listenServer(state.server);

  return {
    listen: () =>
      new Promise<number>((resolvePort, reject) => {
        state.onListening = resolvePort;
        state.onEngineError = reject;
      }),
    onConnection: (listener) => {
      state.onAccepted = listener;
    },
    onError: (listener) => {
      state.errors.push(listener);
    },
    close: () => {
      close(a, state.server);
    },
  };
}

function close(a: VentiAddon, server: number): void {
  try {
    a.closeServer(server);
  } catch {
    // Already closing or closed; the retry loop below still frees the instance.
  }
  const finish = (attempt: number): void => {
    try {
      a.finalizeServer(server);
    } catch (error) {
      const name = error instanceof Error ? error.message : String(error);
      if (name === "UnknownServer") return;
      if (attempt > 0 && (name === "EventsPending" || name === "ServerNotClosed")) {
        setTimeout(() => {
          finish(attempt - 1);
        }, POLL_INTERVAL_MS);
      }
    }
  };
  finish(FINALIZE_ATTEMPTS);
}
