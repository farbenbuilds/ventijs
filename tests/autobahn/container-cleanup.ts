import { spawn } from "node:child_process";

/// Owns the lifetime of every `docker run` client a sharded run starts.
///
/// `--rm` only takes effect when a container *stops*, so a run interrupted by
/// SIGINT or by the job timeout leaves the container running: it keeps holding
/// its report bind mount and keeps writing into a tree the next run deletes with
/// `resetReportDirectory`. Killing the client is necessary and not sufficient, so
/// every container is named and force-removed as well.
type DockerClient = { kill: (signal: NodeJS.Signals) => void };

const state = {
  clients: new Map<DockerClient, string>(),
  names: new Set<string>(),
  installed: false,
};

function remove(names: readonly string[]): void {
  for (const name of names) {
    state.names.delete(name);
    // A container that is already gone is the outcome that was wanted, so a
    // failure here is not reported: the process is on its way out regardless.
    spawn("docker", ["rm", "--force", name], { stdio: "ignore" });
  }
}

function onSignal(): void {
  for (const client of state.clients.keys()) client.kill("SIGTERM");
  remove([...state.names]);
}

/// Registers a client and its container name, installing the signal handlers on
/// the first one. Handlers are installed at most once per process, which is what
/// keeps a four-shard run from accumulating four sets of listeners.
export function registerContainer(client: DockerClient, name: string): void {
  state.clients.set(client, name);
  state.names.add(name);
  if (state.installed) return;
  state.installed = true;
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}

/// Drops a client that has exited, so the interrupt path does not signal a
/// process that is already gone.
export function forgetContainer(client: DockerClient): void {
  state.clients.delete(client);
}

/// Force-removes one container now. Called on the normal path too, so a failed
/// shard cannot leave a container the next run would collide with by name.
export function removeContainer(name: string): void {
  if (!state.names.has(name)) return;
  remove([name]);
}
