/// What a peer's `permessage-deflate` parameters said, once read. Every refusal here is
/// `ws`'s, with the one substitution `deflate.zig` names: a window below 15 is refused
/// rather than accepted, because the compressor is one-shot libdeflate and always emits a
/// full window.

export const WINDOW_BITS = 15;

// RFC 7692 section 7.1.2.1 fixes the range at 8 to 15.
export const MIN_WINDOW_BITS = 8;
export const MAX_WINDOW_BITS = 15;

/// A number naming the window a peer will use, `true` for RFC 7692's valueless form (it
/// can take a window the server chooses), and `undefined` for absent. Three things, not
/// two: `true` and `undefined` both mean "no number here" and the two callers act on
/// them differently, and collapsing them into one `boolean` is what made a bare
/// `client_max_window_bits` in a `ws` offer a refusal instead of an acceptance.
export type WindowAsk = true | number | undefined;

export type Normalized = {
  readonly server_no_context_takeover: boolean;
  readonly client_no_context_takeover: boolean;
  readonly server_max_window_bits: number | undefined;
  /// See `WindowAsk`: a number names the window, `true` is the valueless form.
  readonly client_max_window_bits: WindowAsk;
};

/// `isServer` decides how a valueless `client_max_window_bits` reads, and it is the whole
/// reason the flag is here: RFC 7692 section 7.1.1.2 allows the parameter without a value
/// in a client offer and section 7.1.2.1 requires one in a server response, so the same
/// bytes are an offer in one direction and a protocol error in the other. `ws`
/// distinguishes them exactly this way.
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
      // A client may say "choose"; a server may not, because the value is what it chose.
      return isServer ? true : null;
    }
    return windowSize(value);
  }
  if (key === "server_max_window_bits") return value === "" ? null : windowSize(value);
  return null;
}

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
