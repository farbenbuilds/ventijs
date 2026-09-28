import type { NormalizedPerMessageDeflate } from "../../types/options";
import type { PerMessageDeflateOptions } from "../../types/ws";
import { createError } from "../errors";

export const DEFAULT_MAX_PAYLOAD = 100 * 1024 * 1024;
/// `ws` defaults this to 16 KiB fragments. Documented and defaulted by `ws` and
/// absent from `@types/ws`, so it is read rather than declared.
export const DEFAULT_MAX_FRAGMENTS = 16 * 1024;
export const DEFAULT_MAX_REDIRECTS = 10;

/// How long a close handshake may stay unfinished before the socket is torn down. `ws`
/// bounds this at 30 seconds, and the bound is what makes a close a decision: a peer that
/// never answers leaves its socket `CLOSING` for the life of the process, holding its
/// transport and its codec slot.
export const DEFAULT_CLOSE_TIMEOUT = 30_000;
export const DEFAULT_THRESHOLD = 1024;
export const DEFAULT_CONCURRENCY_LIMIT = 10;

const SUBPROTOCOL_PATTERN = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;

/// Anything that is not a token (notably CR/LF) must never reach a response header.
export function isProtocolToken(value: unknown): value is string {
  return typeof value === "string" && SUBPROTOCOL_PATTERN.test(value);
}

export function invalidOption(message: string, constructor: ErrorConstructor = TypeError): never {
  throw createError("ERR_INVALID_OPTION", message, constructor);
}

export function normalizeProtocols(protocols: string | string[] | undefined): readonly string[] {
  if (protocols === undefined) return [];
  // `ws` wraps a non-array value into a one-element list and validates it, so an
  // out-of-type number or null reports the SyntaxError rather than a TypeError.
  const list = typeof protocols === "string" ? [protocols] : protocols;
  const candidates: readonly unknown[] = Array.isArray(list) ? list : [list];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const protocol of candidates) {
    if (typeof protocol !== "string" || !SUBPROTOCOL_PATTERN.test(protocol) || seen.has(protocol)) {
      invalidOption("An invalid or duplicated subprotocol was specified", SyntaxError);
    }
    seen.add(protocol);
    result.push(protocol);
  }
  return result;
}

/// `ws` accepts comma separated tokens with optional surrounding whitespace and rejects
/// empty, duplicated, or out-of-grammar ones, which is what the validator does after the
/// split.
export function parseProtocolHeader(header: string): readonly string[] {
  return normalizeProtocols(header.split(",").map((protocol) => protocol.trim()));
}

export function normalizePerMessageDeflate(
  value: boolean | PerMessageDeflateOptions | undefined,
  fallback: boolean,
): false | NormalizedPerMessageDeflate {
  // `ws` gates on truthiness: an out-of-type falsy value disables the extension.
  if (value !== undefined && !value) return false;
  const resolved = value ?? fallback;
  if (!resolved) return false;
  const options: PerMessageDeflateOptions = resolved === true ? {} : resolved;
  return {
    serverNoContextTakeover: options.serverNoContextTakeover,
    clientNoContextTakeover: options.clientNoContextTakeover,
    serverMaxWindowBits: options.serverMaxWindowBits,
    clientMaxWindowBits: options.clientMaxWindowBits,
    threshold: options.threshold ?? DEFAULT_THRESHOLD,
    concurrencyLimit: options.concurrencyLimit ?? DEFAULT_CONCURRENCY_LIMIT,
    zlibDeflateOptions: options.zlibDeflateOptions,
    zlibInflateOptions: options.zlibInflateOptions,
  };
}

/// The close deadline, in milliseconds, or 0 for "tear down on the next tick".
/// A non-number or a negative value is refused rather than coerced, because `setTimeout`
/// reads a string as a delay and a negative as zero, giving a caller one socket that
/// closes instantly and another that never closes. A deliberate hardening over `ws`,
/// which coerces; see `COMPATIBILITY.md`.
export function closeTimeoutOf(source: unknown): number {
  const raw = (source as { readonly closeTimeout?: unknown }).closeTimeout;
  if (raw === undefined) return DEFAULT_CLOSE_TIMEOUT;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    invalidOption(
      `The closeTimeout option must be a non-negative number (received ${String(raw)})`,
      RangeError,
    );
  }
  return raw;
}
