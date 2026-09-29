const std = @import("std");
const napi_zig = @import("napi_zig");

/// The npm package-name prefix the per-platform addons are published under. It is a
/// name prefix rather than a directory, so it carries the `@` npm requires.
pub const scope = "@ventiws";

/// The published platforms live in `platforms.json` beside this file and nowhere else.
/// The build graph reads it here and `scripts/stage-publish.mjs` reads it for the
/// release gate, because the two have to agree and a list in only one of them lets the
/// other drift. The build narrows `.npm.platforms` per shard so a runner compiles only
/// what it can, and `napi_zig` generates the scaffolded manifest from that narrowed
/// list, so one shard's manifest declares one platform where the release needs five.
const Manifest = struct { platforms: []const []const u8 };

// `windows_x64` is absent on both layers: `napi_zig`'s ABI-less target has no
// `ws2_32` to link, and the `xev` loop fails `accept` and `read` on Windows.

const manifest_path = "src/builds/platforms.json";

/// Resolves `.npm.platforms` for this build. `-Dnpm-platform` narrows it to the one
/// target a runner owns; the filter is what keeps a Linux runner from attempting the
/// Darwin targets, which fail to link without the Apple SDK.
pub fn resolve(b: *std.Build) []const napi_zig.Platform {
    const listed = read(b);
    const raw = b.option(
        []const u8,
        "npm-platform",
        "Comma-separated published platform suffixes to build (default: all of them)",
    ) orelse return listed;
    if (raw.len == 0) return listed;

    // No `deinit`: the build graph holds the returned slice for the rest of the
    // configure step, so the buffer has to outlive this function. The build allocator is
    // an arena, so the few bytes a shard's list costs are released with the process.
    var kept: std.ArrayList(napi_zig.Platform) = .empty;
    var it = std.mem.splitScalar(u8, raw, ',');
    while (it.next()) |part| {
        const suffix = std.mem.trim(u8, part, " ");
        if (suffix.len == 0) continue;
        if (!contains(listed, suffix)) {
            std.debug.panic(
                "-Dnpm-platform={s} is not one of the published platforms in {s}",
                .{ suffix, manifest_path },
            );
        }
        kept.append(b.allocator, known(b, suffix)) catch @panic("out of memory");
    }
    return kept.items;
}

fn read(b: *std.Build) []const napi_zig.Platform {
    const source = std.Io.Dir.cwd().readFileAlloc(
        b.graph.io,
        b.path(manifest_path).getPath(b),
        b.allocator,
        .limited(8 * 1024),
    ) catch @panic("cannot read " ++ manifest_path);
    const parsed = std.json.parseFromSlice(Manifest, b.allocator, source, .{}) catch
        @panic("cannot parse " ++ manifest_path);
    const out = b.allocator.alloc(napi_zig.Platform, parsed.value.platforms.len) catch
        @panic("out of memory");
    for (parsed.value.platforms, 0..) |suffix, index| {
        out[index] = known(b, suffix);
    }
    return out;
}

/// The enum member for a published suffix. `napi_zig` names its members the way Zig does
/// and the published packages the way npm does, so this is the only translation between
/// the two, and it is a table rather than a parse on purpose.
fn known(b: *std.Build, suffix: []const u8) napi_zig.Platform {
    _ = b;
    for (napi_zig.Platform.defaults) |platform| {
        if (std.mem.eql(u8, platform.suffix(), suffix)) return platform;
    }
    std.debug.panic("{s} is not a platform napi-zig can build", .{suffix});
}

fn contains(listed: []const napi_zig.Platform, suffix: []const u8) bool {
    for (listed) |platform| {
        if (std.mem.eql(u8, platform.suffix(), suffix)) return true;
    }
    return false;
}
