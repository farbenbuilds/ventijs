import type { VentiAddon } from "./addon.ts";

/// Mutable echo state for one target process. The engine owns the listener; this
/// record holds the connection the reply is staged through.
export type EchoState = {
  handle: number;
  connection: bigint | null;
};

/// A connection handle is `generation << 32 | index`, the same packing
/// `src/binding/handle.ts` performs.
export function echoState(): EchoState {
  return { handle: 0, connection: null };
}

export function pack(index: number, generation: number): bigint {
  return (BigInt(generation) << 32n) | BigInt(index);
}

/// The Autobahn echo contract, reduced to its essentials: reply to every message
/// with the same opcode, and change nothing else. Anything smarter would make a
/// fuzzing case pass or fail for a reason the report cannot name.
///
/// The inbound ring is FIFO across the whole server, so this drains until it is
/// empty rather than taking one message per wakeup: a coalesced wakeup would
/// leave messages waiting for an event that never comes, and the suite would
/// record a timeout rather than the protocol error it actually produced.
export function reply(a: VentiAddon, state: EchoState): void {
  const connection = state.connection;
  if (connection === null) return;
  for (;;) {
    const taken = a.takeSocketMessage(state.handle, connection);
    if (taken === null) return;
    const [bytes, isBinary] = taken;
    if (a.sendSocket(state.handle, connection, bytes, isBinary) !== 0) return;
    a.pumpSocket(state.handle, connection);
  }
}
