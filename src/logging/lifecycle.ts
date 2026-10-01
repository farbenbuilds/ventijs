// The auto-wired half of the logger: the compat layer calls these at the lifecycle
// seams, so a host sees records without subscribing to anything. Kept out of the
// per-message path deliberately; only open, close, listening, and error land here.

import { version } from "../../package.json" with { type: "json" };
import type { SocketState } from "../types/socket";
import { fatal, info, ready, warn } from "./logger";

/// A peer controls the close reason, so control characters are replaced rather than
/// written: a newline or an escape sequence could forge a record.
const CONTROL = /\p{Cc}/gu;

function sideOf(state: SocketState): string {
  return state.isServer ? "connection" : "client";
}

export function logServerListening(port: number): void {
  ready(version, Math.round(performance.now()), port);
}

export function logServerPath(path: string): void {
  info("server", `listening on ${path}`);
}

export function logServerClosed(): void {
  info("server", "closed");
}

export function logServerError(error: Error): void {
  fatal("server", error.message);
}

export function logSocketOpen(state: SocketState): void {
  info(sideOf(state), "open");
}

export function logSocketClose(state: SocketState, code: number, reason: Buffer): void {
  const text = reason.length === 0 ? "" : ` ${reason.toString("utf8").replace(CONTROL, "?")}`;
  warn(sideOf(state), `closed ${code}${text}`);
}

export function logSocketError(state: SocketState, error: Error): void {
  fatal(sideOf(state), error.message);
}
