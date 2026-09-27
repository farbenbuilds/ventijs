import { spawn } from "node:child_process";
import { forwardStderr, readLines } from "./child-io.ts";
import type { TargetChild } from "./child-io.ts";
import { DEFAULT_TARGET_HOST, DEFAULT_TARGET_PORT, TARGET_ENTRY_PATH } from "./paths.ts";
import { decodeTargetReady } from "./target-record.ts";
import type { TargetReady } from "./target-record.ts";

export type TargetProcess = {
  readonly ready: TargetReady;
  stop(): Promise<void>;
};

const READY_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 10_000;
const SIGNAL_EXIT_CODE = 130;

/// The live child, so the signal handlers below can reap it. Installing a
/// handler is what stops Node from exiting on its own while the target still
/// owns an engine thread and a bound listener.
const live = {
  child: null as TargetChild | null,
  onInterrupt: null as (() => void) | null,
  onTerminate: null as (() => void) | null,
};

function stopChild(child: TargetChild): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, STOP_TIMEOUT_MS);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

function clearLive(): void {
  if (live.onInterrupt !== null) process.off("SIGINT", live.onInterrupt);
  if (live.onTerminate !== null) process.off("SIGTERM", live.onTerminate);
  live.child = null;
  live.onInterrupt = null;
  live.onTerminate = null;
}

function installSignalHandlers(): void {
  const onSignal = (): void => {
    const child = live.child;
    if (child === null) return;
    live.child = null;
    void stopChild(child).then(() => {
      clearLive();
      process.exit(SIGNAL_EXIT_CODE);
    });
  };
  live.onInterrupt = onSignal;
  live.onTerminate = onSignal;
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}

function environment(): { readonly port: string; readonly host: string } {
  return {
    port: process.env["AUTOBAHN_TARGET_PORT"] ?? String(DEFAULT_TARGET_PORT),
    host: process.env["AUTOBAHN_TARGET_HOST"] ?? DEFAULT_TARGET_HOST,
  };
}

function launch(): TargetChild {
  const { port, host } = environment();
  return spawn(process.execPath, [TARGET_ENTRY_PATH], {
    env: { ...process.env, AUTOBAHN_TARGET_PORT: port, AUTOBAHN_TARGET_HOST: host },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function describeExit(code: number | null, signal: NodeJS.Signals | null, detail: string): string {
  const reason = `ventijs-target: exited before reporting a port (code=${String(code)} signal=${String(signal)})`;
  return detail === "" ? reason : `${reason}: ${detail}`;
}

/// Starts the target and resolves once it has reported its bound port. The
/// child is terminated on every path out of the runner, so a failed probe, a
/// failed gate, and SIGINT all leave no engine thread behind.
export function startTarget(): Promise<TargetProcess> {
  const child = launch();
  live.child = child;
  installSignalHandlers();
  const stderrLines = forwardStderr(child);
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // A child that never reported a port is still holding the listener and
      // the engine thread, so the rejection path reaps it too.
      clearLive();
      void stopChild(child);
      reject(error);
    };
    const timer = setTimeout(() => {
      fail(new Error(`ventijs-target: no ready record within ${READY_TIMEOUT_MS} ms`));
    }, READY_TIMEOUT_MS);
    child.once("error", fail);
    child.once("exit", (code, signal) => {
      fail(new Error(describeExit(code, signal, stderrLines.join("; "))));
    });
    readLines(child, (line) => {
      if (settled) return;
      const ready = decodeTargetReady(line);
      if (ready === null) {
        process.stderr.write(`ventijs-target: ${line}\n`);
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        ready,
        stop: () => {
          clearLive();
          return stopChild(child);
        },
      });
    });
  });
}
