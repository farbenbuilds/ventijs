//! What a peer's `permessage-deflate` parameters said, once read.
//!
//! Split out of `deflate.zig` because this half is arithmetic on a peer's bytes and the
//! other half is a decision about this side's configuration. They disagree often enough
//! to be worth naming apart: the same `client_max_window_bits` is legal in an offer and
//! a protocol error in a response, and a value this codec cannot honour is a refusal
//! here and a smaller message everywhere else.
//!
//! **Every refusal in here is `ws`'s.** `validateParams` and `normalizeParams` are the
//! rules, with the one substitution `deflate.zig` names: a window below 15 is refused
//! rather than accepted, because the compressor is one-shot libdeflate and always emits
//! a full window.

/// The one window this codec's compressor emits, and so the only one it can honour.
export const WINDOW_BITS = 15;

const MIN_WINDOW_BITS = 8;
const MAX_WINDOW_BITS = 15;

/// A `client_max_window_bits` as written by a peer: a number naming the one it will
/// use, `true` for RFC 7692's valueless form, which is a client saying it *can* take a
/// window the server chooses, and `undefined` for absent, which is a client that will
/// not negotiate the parameter at all.
///
/// Three things, not two, which is the reason it is a type of its own: `true` and
/// `undefined` both mean "no number here" and the two callers act on them
/// differently, and collapsing them into one `boolean` is what made a bare
/// `client_max_window_bits` in a `ws` offer a refusal instead of an acceptance.
export type WindowAsk = true | number | undefined;

export type Normalized = {
  readonly server_no_context_takeover: boolean;
  readonly client_no_context_takeover: boolean;
  readonly server_max_window_bits: number | undefined;
  /// `true` for RFC 7692's valueless form, which is a client saying it *can* take a
  /// window the server chooses. It is a different thing from a number, which is a
  /// client naming the one it will use, and it is a different thing again from absent,
  /// which is a client that will not negotiate the parameter at all.
  readonly client_max_window_bits: WindowAsk;
};

/// Collapses a configuration's parameters to at most one value each, or refuses it.
///
/// `isServer` decides how a valueless `client_max_window_bits` reads, and it is the
/// whole reason the flag is here. RFC 7692 section 7.1.1.2 allows the parameter without
/// a value in a client offer and section 7.1.2.1 requires one in a server response, so
/// the same bytes are an offer in one direction and a protocol error in the other. `ws`
/// distinguishes them exactly this way, and a parser that did not would answer a
/// `ws` client's default offer with a 400.
export function normalizeParameters(
  parameters: Readonly<Record<string, readonly string[]>>,
  isServer: boolean,
): Normalized | null {
  const out: Record<string, boolean | number> = {};
  for (const [key, values] of Object.entries(parameters)) {
    if (values.length > 1) return null;
    const value = values[0] ?? "";
    const parsed = parseParameter(key, value, isServer);
    if (parsed === null) return null;
    out[key] = parsed;
  }
  return {
    server_no_context_takeover: out.server_no_context_takeover === true,
    client_no_context_takeover: out.client_no_context_takeover === true,
    server_max_window_bits: numberOf(out.server_max_window_bits),
    client_max_window_bits: windowOf(out.client_max_window_bits),
  };
}

function parseParameter(key: string, value: string, isServer: boolean): boolean | number | null {
  if (key === "server_no_context_takeover" || key === "client_no_context_takeover") {
    return value === "" ? true : null;
  }
  if (key === "client_max_window_bits") {
    if (value === "") {
      // A client may say "choose"; a server may not, because the value is what it
      // chose. `ws` raises the same error text for the second case.
      return isServer ? true : null;
    }
    return windowSize(value);
  }
  if (key === "server_max_window_bits") return value === "" ? null : windowSize(value);
  return null;
}

/// A legal window size, or null. RFC 7692 section 7.1.2.1 fixes the range at 8 to 15.
function windowSize(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_WINDOW_BITS || parsed > MAX_WINDOW_BITS)
    return null;
  return parsed;
}

function windowOf(value: boolean | number | undefined): WindowAsk {
  return typeof value === "number" || value === true ? value : undefined;
}

function numberOf(value: boolean | number | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}
