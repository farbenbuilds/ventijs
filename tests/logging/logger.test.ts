// The logger owns process-wide mutable state, so every test restores the enabled
// default and captures stdout rather than asserting on the terminal. The splash is
// compared byte-for-byte because its art is the contract, not a decoration.

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fatal, info, ready, setLoggerEnabled, warn } from "../../src/logging/logger";

const SPLASH = `██╗   ██╗███████╗███╗   ██╗████████╗██╗██╗    ██╗███████╗
██║   ██║██╔════╝████╗  ██║╚══██╔══╝██║██║    ██║██╔════╝
██║   ██║█████╗  ██╔██╗ ██║   ██║   ██║██║ █╗ ██║███████╗
╚██╗ ██╔╝██╔══╝  ██║╚██╗██║   ██║   ██║██║███╗██║╚════██║
 ╚████╔╝ ███████╗██║ ╚████║   ██║   ██║╚███╔███╔╝███████║
  ╚═══╝  ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝ ╚══╝╚══╝ ╚══════╝`;

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const RECORD = /^\d{2}:\d{2}:\d{2} \| pnpm build : ok\n$/;

const visible = (text: string): string => text.replace(ANSI, "");

function capture(run: () => void): string {
  const spy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  try {
    run();
    return spy.mock.calls.map((call) => String(call[0] ?? "")).join("");
  } finally {
    spy.mockRestore();
  }
}

beforeEach(() => {
  setLoggerEnabled(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.resetModules();
  setLoggerEnabled(true);
});

test.each([info, warn, fatal])("records the time | command : status format", (record) => {
  expect(visible(capture(() => record("pnpm build", "ok")))).toMatch(RECORD);
});

test.each([
  [info, "\u001B[36m"],
  [warn, "\u001B[33m"],
  [fatal, "\u001B[31m"],
])("wraps a record in its level's raw ANSI escapes", (record, color) => {
  expect(capture(() => record("pnpm build", "ok"))).toContain(color);
});

// The shape regex passes for any two-digit triple; pinning the clock proves the
// value is read from the local Date rather than a constant.
test("derives the record time from the local system clock", () => {
  vi.setSystemTime(new Date(2024, 0, 2, 3, 4, 5));
  expect(visible(capture(() => info("pnpm build", "ok")))).toBe("03:04:05 | pnpm build : ok\n");
});

// The environment switch is read once at load, so these two need a fresh module
// rather than a call to the toggle, and the suite's own VENTIWS_LOG=0 is restored
// after each of them.
test("loads enabled unless VENTIWS_LOG is 0", async () => {
  vi.stubEnv("VENTIWS_LOG", "");
  vi.resetModules();
  const fresh = await import("../../src/logging/logger");
  expect(visible(capture(() => fresh.info("pnpm build", "ok")))).toMatch(RECORD);
});

test("VENTIWS_LOG=0 loads the logger disabled", async () => {
  vi.stubEnv("VENTIWS_LOG", "0");
  vi.resetModules();
  const fresh = await import("../../src/logging/logger");
  expect(capture(() => fresh.info("pnpm build", "ok"))).toBe("");
});

test("VENTIWS_LOG is read once, at load", async () => {
  vi.stubEnv("VENTIWS_LOG", "");
  vi.resetModules();
  const fresh = await import("../../src/logging/logger");
  vi.stubEnv("VENTIWS_LOG", "0");
  expect(visible(capture(() => fresh.info("pnpm build", "ok")))).toMatch(RECORD);
});

test("a disabled logger writes nothing at all", () => {
  setLoggerEnabled(false);
  const output = capture(() => {
    info("pnpm build", "ok");
    warn("pnpm lint", "warn");
    fatal("pnpm test", "fail");
    ready("1.0.0-beta", 42, 8080);
  });
  expect(output).toBe("");
});

test("setLoggerEnabled(true) re-enables a silenced logger", () => {
  setLoggerEnabled(false);
  setLoggerEnabled(true);
  expect(visible(capture(() => info("pnpm build", "ok")))).toMatch(RECORD);
});

test("ready prints the splash, version line, and local address in order", () => {
  const chunks = visible(capture(() => ready("1.0.0-beta", 42, 8080))).split("\n");
  expect(chunks.slice(0, 6).join("\n")).toBe(SPLASH);
  expect(chunks.slice(6, 11)).toEqual([
    "",
    "ventiws 1.0.0-beta ready in 42",
    "",
    "➜  Local: localhost:8080/",
    "",
  ]);
});

test("ready emits one trailing newline per line", () => {
  const output = visible(capture(() => ready("1.0.0-beta", 42, 8080)));
  expect(output.endsWith("\n\n")).toBe(true);
  expect(output.split("\n")).toHaveLength(12);
});
