//! Zig unit test root: every testable module in `src/engine/` has a `<module>_test.zig`
//! in the same plane folder below, and `src/builds/testing.zig` compiles this root, so a
//! new suite means a new import. The engine-coupled `server` and `connections` modules
//! keep their coverage in the binding tests, which need a live Node-API environment.

test {
    _ = @import("ffi/lib_test.zig");
    _ = @import("ffi/codec_abi_test.zig");
    _ = @import("socket/handles_test.zig");
    _ = @import("server/options_test.zig");
    _ = @import("server/registry_test.zig");
    _ = @import("channel/events_test.zig");
    _ = @import("channel/ring_test.zig");
    _ = @import("server/ports_test.zig");
    _ = @import("channel/callbacks_test.zig");
    _ = @import("server/instance_test.zig");
    _ = @import("socket/payload_test.zig");
    _ = @import("socket/socket_test.zig");
    _ = @import("socket/socket_ops_test.zig");
    _ = @import("socket/connections_test.zig");
    _ = @import("socket/inbound_purge_test.zig");
    _ = @import("codec/utf8_test.zig");
    _ = @import("codec/decode_test.zig");
    _ = @import("codec/encode_test.zig");
    _ = @import("codec/boundary_test.zig");
    _ = @import("codec/reject_test.zig");
    _ = @import("codec/reject-close_test.zig");
    _ = @import("codec/fragment_test.zig");
    _ = @import("codec/backpressure_test.zig");
    _ = @import("codec/close_test.zig");
    _ = @import("codec/fragments_test.zig");
    _ = @import("codec/handles_test.zig");
    _ = @import("codec/deflate_test.zig");
    _ = @import("codec/rsv1_test.zig");
}
