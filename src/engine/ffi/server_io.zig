//! N-API wrappers for the server lifecycle.
//!
//! Each wrapper validates the untrusted configuration or resolves the
//! generation-checked server handle before the lifecycle function runs. The
//! lifecycle itself stays in `server.zig`; this seam exists so the exported
//! surface has one small owner, mirroring `socket_io.zig`.

const napi = @import("napi-zig");
const capacities = @import("../server/capacities.zig");
const instance = @import("../server/instance.zig");
const codec_abi = @import("codec_abi.zig");
const codec_caps = @import("../codec/capacities.zig");
const options = @import("../server/options.zig");
const server = @import("../server/server.zig");

pub fn create_server(env: napi.Env, raw: options.RawConfig, dispatch: napi.Callback) !u40 {
    const config = try options.trust(raw);
    return server.create(config, dispatch, env);
}

pub fn listen_server(env: napi.Env, raw: u40) !void {
    const target = instance.lookup(env, raw) orelse return error.UnknownServer;
    try server.listen(target);
}

pub fn close_server(env: napi.Env, raw: u40) !void {
    const target = instance.lookup(env, raw) orelse return error.UnknownServer;
    try server.close(target);
}

pub fn finalize_server(env: napi.Env, raw: u40) !void {
    const target = instance.lookup(env, raw) orelse return error.UnknownServer;
    try server.finalize(target);
}

/// Events the server channel could not queue because its ring was full. A
/// non-zero count means some dispatch was lost to a stalled consumer.
pub fn server_dropped_events(env: napi.Env, raw: u40) !u64 {
    const target = instance.lookup(env, raw) orelse return error.UnknownServer;
    return target.channel.dropped();
}

/// The capacities the addon was compiled with, as a JavaScript object.
///
/// `capacities.zig` says each of these "is also a promise the compatibility layer
/// has to keep", and the promise was previously kept only in prose and in
/// hardcoded test constants. A hardcoded duplicate is exactly how a compiled
/// limit and its documented value drift apart: the message cap was raised from
/// 32 KiB to 64 KiB and the test that asserted the boundary kept asserting the
/// old number, so it passed by asserting something the engine no longer did.
///
/// These are compile-time constants with no server behind them, so the entry
/// point takes no handle and cannot fail.
pub fn engine_limits(env: napi.Env) !napi.Val {
    var out: [7]napi.Val = undefined;
    out[0] = try env.createUint32(capacities.connection_capacity);
    out[1] = try env.createUint32(capacities.message_capacity);
    out[2] = try env.createUint32(capacities.frame_capacity);
    out[3] = try env.createUint32(@intCast(instance.inbound_slots));
    out[4] = try env.createUint32(@intCast(instance.payload_slots));
    // The codec's own fragment bound, which is what a `maxFragments` option is
    // measured against. Reported here rather than left out because the option is a
    // documented `ws` limit: a caller who cannot read the number it is competing with
    // has to guess at it.
    out[5] = try env.createUint32(@intCast(codec_caps.max_fragments));
    // The ceiling a codec's `maxPayload` argument may not exceed. Nothing forces a
    // limit on a runtime-sized buffer except the boundary's own number width, so
    // this is the honest answer to "how large a message can ventijs carry", and it
    // is reported rather than documented so a caller asking for more finds out
    // before the first connection rather than from a RangeError.
    out[6] = try env.createUint32(codec_abi.ceiling_arg_max);
    // NUL-terminated because `setNamedProperty` takes a sentinel slice, so the
    // names are literals rather than a comptime-length table.
    const names = [_][:0]const u8{
        "connectionCapacity",
        "messageBytes",
        "frameBytes",
        "inboundSlots",
        "outboundSlots",
        "maxFragments",
        "maxPayloadBytes",
    };
    const object = try env.createObject();
    for (names, out) |name, value| {
        try object.setNamedProperty(env, name, value);
    }
    return object;
}
