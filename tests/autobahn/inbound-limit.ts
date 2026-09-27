import { loadVentijsAddon } from "./addon.ts";

/// The compiled inbound message capacity, read from the addon.
///
/// This used to be a restated `32 * 1024` in three files, and a restated constant
/// is how the engine's cap was raised to 64 KiB while a test kept asserting 32 KiB
/// and passed by asserting something the engine no longer did. The value is a Zig
/// `comptime` constant baked into the compiled artifact, so the artifact is the only
/// place it is authoritative and the only place it can be read from.
///
/// One read per process, at module load. The harness loads the addon anyway to run
/// the target, so this costs a `dlopen` that was already going to happen and turns
/// three literals into one read.
export const INBOUND_LIMIT_BYTES: number = loadVentijsAddon().engineLimits().messageBytes;
