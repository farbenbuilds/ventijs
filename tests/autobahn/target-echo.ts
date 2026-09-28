import type { VentiAddon } from "./addon.ts";

export type EchoState = {
  handle: number;
  connection: bigint | null;
};

/// A connection handle is `generation << 32 | index`, the packing `src/binding/handle.ts` does.
export function echoState(): EchoState {
  return { handle: 0, connection: null };
}

export function pack(index: number, generation: number): bigint {
  return (BigInt(generation) << 32n) | BigInt(index);
}

/// Reply to every message with the same opcode and change nothing else: anything smarter makes a
/// case pass or fail for a reason the report cannot name.
///
/// The inbound ring is FIFO across the whole server, so this drains until empty: a coalesced
/// wakeup would leave messages waiting for an event that never comes.
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

/// A case that lost the race leaves records at the head of a strictly ordered FIFO, and nothing
/// could match them.
export function purge(a: VentiAddon, state: EchoState, index: number, generation: number): void {
  a.purgeSocketMessage(state.handle, index, generation);
}
