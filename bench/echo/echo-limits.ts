/// The pinned engine compiles `message_capacity` to 32 KiB
/// (`src/engine/server/options.zig`), so a larger payload cannot be echoed by
/// ventiws at any speed. `ws` accepts hundreds of MiB, which means a size above
/// the ceiling is not a slower run, it is a run ventiws cannot finish. The
/// matrix stops at the ceiling so a row can never claim a win it did not earn.
export const ECHO_PAYLOAD_CEILING_BYTES = 32 * 1024;
