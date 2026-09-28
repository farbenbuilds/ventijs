/// A codec's own status: what it refused, what it is, and how to drop its buffers. None
/// of these copies a payload and none can fail.

import { CODEC_FAILURES, type CodecFailureName } from "./codec-status";
import { callNative } from "./errors";
import { loadAddon } from "./load";

export function codecFailureCode(handle: bigint): number {
  const addon = loadAddon();
  return callNative(() => addon.codecFailureCode(handle));
}

/// Read rather than parsed off the close code, because the two are not one-to-one: a 1002
/// is a dozen different faults, so a code alone cannot name the caller's own misconfiguration.
export function codecFailure(handle: bigint): CodecFailureName | null {
  const addon = loadAddon();
  const ordinal = callNative(() => addon.codecFailure(handle));
  return CODEC_FAILURES[ordinal - 1] ?? null;
}

export function resetCodec(handle: bigint): void {
  const addon = loadAddon();
  callNative(() => addon.codecReset(handle));
}

export function codecRole(handle: bigint): number {
  const addon = loadAddon();
  return callNative(() => addon.codecRole(handle));
}

/// Read back rather than echoed from the option, because the only way to know the limit in
/// force is to ask the thing enforcing it: a `maxPayload` of 0 is `ws`'s "no limit".
export function codecCeilings(handle: bigint): { maxPayload: number; maxFragments: number } | null {
  const addon = loadAddon();
  const ceilings: [number, number] | null = callNative(() => addon.codecCeilings(handle));
  if (ceilings === null) return null;
  return { maxPayload: ceilings[0], maxFragments: ceilings[1] };
}
