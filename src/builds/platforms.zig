const std = @import("std");
const napi_zig = @import("napi_zig");

/// The npm package-name prefix the per-platform addons are published under. It is a
/// name prefix rather than a directory, so it carries the `@` npm requires.
pub const scope = "@ventiws";

/// The platforms a published ventiws ships, and the only ones a release may produce.
/// Each is built on a runner of that same platform: the engine builds its vendored
/// BoringSSL, lsquic, libdeflate, and zlib for the host target, and the release path
/// links those host archives into a cross-compiled addon, so a cross build misbehaves.
/// `windows_x64` is absent on both layers: `napi_zig`'s ABI-less target has no
/// `ws2_32` to link, and the `xev` loop fails `accept` and `read` on Windows.
pub const published = [_]napi_zig.Platform{
    .linux_x64_gnu,
    .linux_arm64_gnu,
    .linux_x64_musl,
    .macos_x64,
    .macos_arm64,
};

/// Resolves `.npm.platforms` for this build. `-Dnpm-platform` narrows the list to the one
/// platform the runner is native for; a runner left with the full set would compile the
/// other five against host archives and against no Apple SDK, and the release would
/// publish six broken packages instead of one correct one.
pub fn resolve(b: *std.Build) []const napi_zig.Platform {
    const raw = b.option(
        []const u8,
        "npm-platform",
        "Comma-separated published platform suffixes to build (default: all of them)",
    ) orelse return &published;
    if (raw.len == 0) return &published;

    // No `deinit`: the build graph holds the returned slice for the rest of the
    // configure step, so the buffer has to outlive this function. The build allocator is
    // an arena, so the few bytes a shard's list costs are released with the process.
    var list: std.ArrayList(napi_zig.Platform) = .empty;
    var it = std.mem.splitScalar(u8, raw, ',');
    while (it.next()) |part| {
        const suffix = std.mem.trim(u8, part, " ");
        if (suffix.len == 0) continue;
        const platform = find(suffix) orelse std.debug.panic(
            "-Dnpm-platform={s} is not a published platform; the published suffixes are {s}",
            .{ suffix, suffixes(b.allocator) },
        );
        list.append(b.allocator, platform) catch @panic("out of memory");
    }
    return list.items;
}

fn find(suffix: []const u8) ?napi_zig.Platform {
    for (published) |platform| {
        if (std.mem.eql(u8, platform.suffix(), suffix)) return platform;
    }
    return null;
}

/// Rendered into the `-Dnpm-platform` error, because "not a published platform" is only
/// actionable next to the list it was checked against.
fn suffixes(allocator: std.mem.Allocator) []const u8 {
    var out: [published.len][]const u8 = undefined;
    for (published, 0..) |platform, index| out[index] = platform.suffix();
    return std.mem.join(allocator, ", ", &out) catch @panic("out of memory");
}
