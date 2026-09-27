import { spawn } from "node:child_process";
import { forwardStderr, readLines } from "./child-io.ts";
import type { TargetChild } from "./child-io.ts";
import { releaseTarget, stopChild, trackTarget } from "./target-signals.ts";
import { DEFAULT_TARGET_HOST, DEFAULT_TARGET_PORT, TARGET_ENTRY_PATH } from "./paths.ts";
import { decodeTargetReady } from "./target-record.ts";
import type { TargetReady } from "./target-record.ts";

export type TargetProcess = {
  readonly ready: TargetReady;
  stop(): Promise<void>;
};

/// Explicit port and host rather than a process-global environment, because a
/// sharded run starts one target per shard and they have to differ.
export type TargetAddress = {
  readonly port: number;
  readonly host: string;
};

const READY_TIMEOUT_MS = 30_000;
const DEFAULT_ADDRESS: TargetAddress = { port: DEFAULT_TARGET_PORT, host: DEFAULT_TARGET_HOST };

/// Resolves the port and host a target binds.
///
/// The environment override applies only to the default address. A sharded run
/// passes an explicit port per shard, and honouring one global override there
/// would start every shard on the same port, so three of them would fail to bind
/// and the plan would be discarded with no diagnostic.
function environment(
  address: TargetAddress,
  explicit: boolean,
): {
  readonly port: string;
  readonly host: string;
} {
  const port = explicit
    ? address.port
    : Number(process.env["AUTOBAHN_TARGET_PORT"] ?? address.port);
  const host = explicit ? address.host : (process.env["AUTOBAHN_TARGET_HOST"] ?? address.host);
  return { port: String(port), host };
}

function launch(address: TargetAddress, explicit: boolean): TargetChild {
  const { port, host } = environment(address, explicit);
  return spawn(process.execPath, [TARGET_ENTRY_PATH], {
    env: { ...process.env, AUTOBAHN_TARGET_PORT: port, AUTOBAHN_TARGET_HOST: host },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function describeExit(code: number | null, signal: NodeJS.Signals | null, detail: string): string {
  const reason = `ventijs-target: exited before reporting a port (code=${String(code)} signal=${String(signal)})`;
  return detail === "" ? reason : `${reason}: ${detail}`;
}

/// Starts one target and resolves once it has reported its bound port. The child
/// is reaped on every path out of the runner, so a failed probe, a failed gate,
/// and SIGINT all leave no engine thread behind.
export function startTarget(address?: TargetAddress): Promise<TargetProcess> {
  const explicit = address !== undefined;
  const child = launch(address ?? DEFAULT_ADDRESS, explicit);
  trackTarget(child);
  const stderrLines = forwardStderr(child);
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // A child that never reported a port is still holding the listener and
      // the engine thread, so the rejection path reaps it too.
      releaseTarget(child);
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
          releaseTarget(child);
          return stopChild(child);
        },
      });
    });
  });
}

/// Starts every shard's target and resolves only when all of them are listening.
///
/// One round rather than a `Promise.all` per shard, so a target that cannot bind
/// fails in seconds with a named error instead of leaving the other shards to
/// finish a run against a peer that was never there. Targets already started are
/// reaped before the error propagates.
export async function startTargets(
  addresses: readonly TargetAddress[],
): Promise<readonly TargetProcess[]> {
  const started: TargetProcess[] = [];
  try {
    for (const address of addresses) started.push(await startTarget(address));
  } catch (error) {
    await stopTargets(started);
    throw error;
  }
  return started;
}

export async function stopTargets(targets: readonly TargetProcess[]): Promise<void> {
  await Promise.all(targets.map((target) => target.stop()));
}
