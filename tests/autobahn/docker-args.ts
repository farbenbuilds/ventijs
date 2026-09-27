import { CONTAINER_CONFIG_PATH, CONTAINER_REPORTS_DIR, REPORTS_HOST_DIR } from "./paths.ts";

/// Pinned by digest alone. A tag would let a rebuilt image change the case set
/// under the gate, and the 517-case contract is only meaningful against a
/// fixed digest.
///
/// The reference is digest-only on purpose. The `0.8.2` tag this project
/// previously documented does not exist on Docker Hub, so
/// `autobahn-testsuite:0.8.2@sha256:...` is an unpullable reference and the job
/// would fail at `docker run` rather than at a real protocol assertion. This
/// digest is the image published as `latest` and as `25.10.1`; those two tags
/// resolve to the identical manifest, so dropping the tag loses no information
/// and removes the failure mode.
export const AUTOBAHN_IMAGE =
  "crossbario/autobahn-testsuite@sha256:519915fb568b04c9383f70a1c405ae3ff44ab9e35835b085239c258b6fac3074";

/// The container reaches the target through the host gateway rather than
/// `--network=host`, which Docker Desktop only supports behind an opt-in. The
/// target therefore binds a routable address, not loopback.
export const HOST_GATEWAY = "host.docker.internal";

/// The report is written by the container as root unless the host directory is
/// mapped to the invoking user, which would make every repeated local run fail
/// on a root-owned leftover. `--user` keeps the files owned by the caller.
export function dockerArgs(input: {
  readonly uid: string;
  readonly gid: string;
  readonly configHostPath: string;
}): readonly string[] {
  return [
    "run",
    "--rm",
    "--user",
    `${input.uid}:${input.gid}`,
    "--add-host",
    `${HOST_GATEWAY}:host-gateway`,
    "-v",
    `${input.configHostPath}:${CONTAINER_CONFIG_PATH}:ro`,
    "-v",
    `${REPORTS_HOST_DIR}:${CONTAINER_REPORTS_DIR}`,
    AUTOBAHN_IMAGE,
    "wstest",
    "-m",
    "fuzzingclient",
    "-s",
    CONTAINER_CONFIG_PATH,
  ];
}
