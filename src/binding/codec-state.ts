//! A codec's own status: what it refused, what it is, and how to drop its buffers.
//!
//! Split from `codec.ts` because these calls answer questions about the codec rather
//! than moving data through it. None of them copies a payload and none of them can
//! fail, so a caller reaching for one of these is asking about the connection rather
//! than about a message.

import { callNative } from "./errors";
import { loadAddon } from "./load";

/// The close code a refused frame maps to, or 0 while the connection is healthy.
export function codecFailureCode(handle: bigint): number {
  const addon = loadAddon();
  return callNative(() => addon.codecFailureCode(handle));
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
