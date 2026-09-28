import { loadVentijsAddon } from "./addon.ts";

/// The compiled inbound message capacity, read from the addon: it is a Zig `comptime`
/// constant in the artifact, so the artifact is the only authoritative place. It was a
/// restated `32 * 1024` in three files, which is how the cap rose to 64 KiB while a test
/// kept passing against a limit the engine no longer had.
export const INBOUND_LIMIT_BYTES: number = loadVentijsAddon().engineLimits().messageBytes;
