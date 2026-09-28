//! Zig unit test entry point. `src/builds/testing.zig` compiles this as the test root
//! so the module path stays at `src/`; the suites live in `src/engine-tests/`, one
//! `<module>_test.zig` per engine module, aggregated by `root.zig`.

test {
    _ = @import("engine-tests/root.zig");
}
