//! A codec's own status: what it refused, what it is, and how to drop its buffers.
//!
//! Split from `codec.ts` because these calls answer questions about the codec rather
//! than moving data through it. None of them copies a payload and none of them can
//! fail, so a caller reaching for one of these is asking about the connection rather
//! than about a message.

import { CODEC_FAILURES, type CodecFailureName } from "./codec-status";
import { callNative } from "./errors";
import { loadAddon } from "./load";

/// The close code a refused frame maps to, or 0 while the connection is healthy.
export function codecFailureCode(handle: bigint): number {
  const addon = loadAddon();
  return callNative(() => addon.codecFailureCode(handle));
}

/// The failure a refused frame produced, or 0 while the connection is healthy.
///
/// Read rather than parsed off the close code, because the two are not one-to-one: a
/// 1002 is a dozen different faults and a caller that only has the code cannot tell a
/// peer's bad frame from its own misconfiguration.
export function codecFailure(handle: bigint): CodecFailureName | null {
  const addon = loadAddon();
  const ordinal = callNative(() => addon.codecFailure(handle));
  return CODEC_FAILURES[ordinal - 1] ?? null;
}

/// Drops every buffered byte and event, for a connection abandoned early.
export function resetCodec(handle: bigint): void {
  const addon = loadAddon();
  callNative(() => addon.codecReset(handle));
}

/// The role a codec was created for, or -1 once it has been released.
export function codecRole(handle: bigint): number {
  const addon = loadAddon();
  return callNative(() => addon.codecRole(handle));
}

/// The per-connection ceilings a codec enforces, as `[maxPayload, maxFragments]`, or
/// null once the handle is released.
///
/// Read back rather than echoed from the option, because the only way to know the
/// limit in force is to ask the thing enforcing it, and the two can differ: a
/// `maxPayload` of 0 is `ws`'s "no limit" and is translated to the ceiling on the way
/// in, so the option a caller set and the limit a codec enforces are not the same
/// number whenever the caller set zero.
export function codecCeilings(handle: bigint): { maxPayload: number; maxFragments: number } | null {
  const addon = loadAddon();
  const ceilings: [number, number] | null = callNative(() => addon.codecCeilings(handle));
  if (ceilings === null) return null;
  return { maxPayload: ceilings[0], maxFragments: ceilings[1] };
}
