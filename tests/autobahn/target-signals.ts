import type { TargetChild } from "./child-io.ts";

/// Tracks every live target child and reaps them all on an interrupt.
///
/// A sharded run owns one target per shard, and a process that exits while an
/// engine thread still holds a bound listener leaks both the thread and the
/// socket. The handlers are installed once per process, so four shards do not
/// accumulate four sets of listeners.
const STOP_TIMEOUT_MS = 10_000;
const SIGNAL_EXIT_CODE = 130;

const live = {
  children: [] as TargetChild[],
  onInterrupt: null as (() => void) | null,
  onTerminate: null as (() => void) | null,
};

export function stopChild(child: TargetChild): Promise<void> {
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

function clear(): void {
  if (live.onInterrupt !== null) process.off("SIGINT", live.onInterrupt);
  if (live.onTerminate !== null) process.off("SIGTERM", live.onTerminate);
  live.children = [];
  live.onInterrupt = null;
  live.onTerminate = null;
}

function install(): void {
  if (live.onInterrupt !== null) return;
  const onSignal = (): void => {
    const children = [...live.children];
    if (children.length === 0) return;
    live.children = [];
    void Promise.all(children.map((child) => stopChild(child))).then(() => {
      clear();
      process.exit(SIGNAL_EXIT_CODE);
    });
  };
  live.onInterrupt = onSignal;
  live.onTerminate = onSignal;
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}

export function trackTarget(child: TargetChild): void {
  live.children.push(child);
  install();
}

export function releaseTarget(child: TargetChild): void {
  live.children = live.children.filter((entry) => entry !== child);
  if (live.children.length === 0) clear();
}
