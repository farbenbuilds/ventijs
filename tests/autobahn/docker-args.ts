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
