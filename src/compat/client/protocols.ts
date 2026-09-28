import { createError } from "../errors";

/// RFC 6455 section 11.3.4: a subprotocol is a token per RFC 7230.
const TOKEN = /^[!#$%&'*+\-.^_`|~\dA-Za-z]+$/;

/// `ws` refuses the whole list rather than dropping what it does not understand, because
/// a caller that asked for two protocols and silently got one has no way to notice: the
/// server picks, the client never sees what it dropped.
export function normalizeProtocols(protocols?: string | string[]): string[] {
  if (protocols === undefined) return [];
  const list = typeof protocols === "string" ? [protocols] : protocols;
  if (!Array.isArray(list)) {
    throw createError(
      "ERR_INVALID_OPTION",
      "An invalid or duplicated subprotocol was specified",
      SyntaxError,
    );
  }
  const seen = new Set<string>();
  for (const protocol of list) {
    if (typeof protocol !== "string" || !TOKEN.test(protocol) || seen.has(protocol)) {
      throw createError(
        "ERR_INVALID_OPTION",
        "An invalid or duplicated subprotocol was specified",
        SyntaxError,
      );
    }
    seen.add(protocol);
  }
  return [...list];
}

export type ProtocolSet = ReadonlySet<string>;

export function protocolSet(protocols: readonly string[]): ProtocolSet {
  return new Set(protocols);
}

/// `new WebSocket(address, options)` is a declared overload, so the second argument is
/// read before it is validated: a non-array object in the subprotocol slot is promoted to
/// the options slot, which is what `ws` does and what `@types/ws` declares. Passing it
/// through instead refused an object as an invalid subprotocol, so a documented, typed
/// signature threw on every call.
export function promoteOptions<T>(
  protocols: string | string[] | undefined,
  options: T | undefined,
): { protocols: string | string[] | undefined; options: T | undefined } {
  if (typeof protocols !== "object" || protocols === null || Array.isArray(protocols)) {
    return { protocols, options };
  }
  return { protocols: undefined, options: protocols as unknown as T };
}

/// A server that picks nothing when the client offered something is a protocol error
/// rather than a default: the client asked for a subprotocol and would otherwise have no
/// way to notice it got something else.
export function protocolRejection(chosen: string | undefined, offered: ProtocolSet): string | null {
  if (chosen === undefined) {
    return offered.size > 0 ? "Server sent no subprotocol" : null;
  }
  if (offered.size === 0) return "Server sent a subprotocol but none was requested";
  if (!offered.has(chosen)) return "Server sent an invalid subprotocol";
  return null;
}
