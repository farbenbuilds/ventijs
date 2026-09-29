//! Unit tests for `src/engine/server/ports.zig`.

const std = @import("std");
const ports = @import("../../engine/server/ports.zig");

test "port_of reads IPv4 and IPv6 network-order ports" {
    var v4: std.posix.sockaddr.storage = undefined;
    const in4: *std.posix.sockaddr.in = @ptrCast(&v4);
    in4.* = .{ .port = std.mem.nativeToBig(u16, 8080), .addr = 0 };
    try std.testing.expectEqual(@as(?u16, 8080), ports.port_of(&v4));

    var v6: std.posix.sockaddr.storage = undefined;
    const in6: *std.posix.sockaddr.in6 = @ptrCast(&v6);
    in6.* = .{
        .family = std.posix.AF.INET6,
        .port = std.mem.nativeToBig(u16, 3000),
        .flowinfo = 0,
        .addr = [_]u8{0} ** 16,
        .scope_id = 0,
    };
    try std.testing.expectEqual(@as(?u16, 3000), ports.port_of(&v6));
}

test "port_of ignores non-IP families" {
    var storage: std.posix.sockaddr.storage = undefined;
    const address: *std.posix.sockaddr = @ptrCast(&storage);
    address.family = std.posix.AF.UNIX;
    try std.testing.expectEqual(@as(?u16, null), ports.port_of(&storage));
}

test "bound_port rejects an invalid descriptor" {
    // `socket_t` is an integer on POSIX and a handle on Windows, so a literal invalid
    // descriptor does not compile on both. A descriptor that is not open is the same
    // case either way: `getsockname` fails and the port is reported as unknown.
    const invalid: std.posix.socket_t = if (@typeInfo(std.posix.socket_t) == .pointer)
        @ptrFromInt(std.math.maxInt(usize))
    else
        @as(std.posix.socket_t, -1);
    try std.testing.expectEqual(@as(?u16, null), ports.bound_port(invalid));
}
