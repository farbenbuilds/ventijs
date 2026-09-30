import { CONTAINER_CONFIG_PATH, CONTAINER_REPORTS_DIR } from "./paths.ts";

/// Pinned by digest alone: a tag would let a rebuilt image change the case set under the gate.
/// The `0.8.2` tag this project previously documented does not exist on Docker Hub, so
/// `autobahn-testsuite:0.8.2@sha256:...` is unpullable and the job would fail at `docker run`.
export const AUTOBAHN_IMAGE =
  "crossbario/autobahn-testsuite@sha256:519915fb568b04c9383f70a1c405ae3ff44ab9e35835b085239c258b6fac3074";

/// The host gateway rather than `--network=host`, which Docker Desktop only supports behind an opt-in.
export const HOST_GATEWAY = "host.docker.internal";

/// `--user` keeps the report files owned by the caller; the container writes as root otherwise.
export function dockerArgs(input: {
  readonly uid: string;
  readonly gid: string;
  readonly configHostPath: string;
  readonly reportsHostDir: string;
  readonly name: string;
}): readonly string[] {
  return [
    "run",
    "--rm",
    "--name",
    input.name,
    "--user",
    `${input.uid}:${input.gid}`,
    "--add-host",
    `${HOST_GATEWAY}:host-gateway`,
    "-v",
    `${input.configHostPath}:${CONTAINER_CONFIG_PATH}:ro`,
    "-v",
    `${input.reportsHostDir}:${CONTAINER_REPORTS_DIR}`,
    AUTOBAHN_IMAGE,
    "wstest",
    "-m",
    "fuzzingclient",
    "-s",
    CONTAINER_CONFIG_PATH,
  ];
}

import { spawn } from "node:child_process";

/// `--rm` only takes effect when a container *stops*, so a run interrupted by SIGINT or the job
/// timeout leaves it running, holding its report bind mount over a tree the next run deletes.
/// Every container is therefore named and force-removed as well.
type DockerClient = { kill: (signal: NodeJS.Signals) => void };

const state = {
  clients: new Map<DockerClient, string>(),
  names: new Set<string>(),
  installed: false,
};

function remove(names: readonly string[]): void {
  for (const name of names) {
    state.names.delete(name);
    // A container that is already gone is the outcome that was wanted, so no failure is reported.
    spawn("docker", ["rm", "--force", name], { stdio: "ignore" });
  }
}

function onSignal(): void {
  for (const client of state.clients.keys()) client.kill("SIGTERM");
  remove([...state.names]);
}

/// Installed at most once per process, which keeps a four-shard run from accumulating four listener sets.
export function registerContainer(client: DockerClient, name: string): void {
  state.clients.set(client, name);
  state.names.add(name);
  if (state.installed) return;
  state.installed = true;
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}

/// Drops a client that has exited, so the interrupt path does not signal a gone process.
export function forgetContainer(client: DockerClient): void {
  state.clients.delete(client);
}

/// Called on the normal path too, so a failed shard cannot leave a container the next run collides with.
export function removeContainer(name: string): void {
  if (!state.names.has(name)) return;
  remove([name]);
}
