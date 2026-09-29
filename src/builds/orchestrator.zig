const std = @import("std");
const napi_zig = @import("napi_zig");
const default_target = @import("targets/default.zig");
const platforms = @import("platforms.zig");
const testing = @import("testing.zig");
const vendor = @import("vendor.zig");

/// Wires the native addon, its engine dependency, build metadata, and tests.
pub fn inject(b: *std.Build) void {
    const target = b.standardTargetOptions(.{ .default_target = default_target.query(b) });
    const optimize = b.standardOptimizeOption(.{});

    const napi_dep = b.dependency("napi_zig", .{});
    const engine_dep = vendor.engine_dependency(b, target, optimize);
    const engine = engine_dep.module("uWebZockets");
    const zslay_dep = b.dependency("zslay", .{ .target = target, .optimize = optimize });
    const zslay = zslay_dep.module("zslay");

    const build_options = b.addOptions();
    build_options.addOption([]const u8, "engine_version", vendor.engine_version(b, engine_dep));
    const options_module = build_options.createModule();

    napi_zig.addLib(b, napi_dep, .{
        .name = "ventiws",
        .root = b.path("src/lib.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{
            .{ .name = "uWebZockets", .module = engine },
            .{ .name = "zslay", .module = zslay },
            .{ .name = "build_options", .module = options_module },
        },
        // The npm config only takes effect under `-Dnpm=true`, which the release build
        // adds. It is what cross-compiles the addon per platform and scaffolds the
        // `@ventiws/binding-*` packages, so the per-platform artifact is a build-graph
        // decision rather than something the loader and a workflow agree on by hand.
        // `dts` stays `.none` because TypeScript owns the published types; the loader
        // the toolchain would generate here is also not the one that ships.
        .npm = .{
            .scope = platforms.scope,
            .description = "A drop-in replacement for ws for Node.js, built on the first-party µWebZockets Zig engine via napi-zig.",
            .license = "MIT",
            .repository = "farbenbuilds/ventiws",
            .platforms = platforms.resolve(b),
        },
    });

    testing.inject(b, .{
        .napi = napi_dep,
        .engine = engine,
        .zslay = zslay,
        .options = options_module,
        .target = target,
        .optimize = optimize,
    });
}
