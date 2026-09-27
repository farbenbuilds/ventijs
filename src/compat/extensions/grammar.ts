/// The RFC 6455 extension header grammar, parsed.
///
/// Split from `scan.ts` because parsing is one policy -- what a header is allowed to
/// say, which is `ws`'s policy -- and scanning is the mechanical part. This one owns
/// the shapes; the scanner owns the characters.
///
/// **The shape is what `ws` uses**, deliberately. `ws` parses into a map of extension
/// name to a list of configurations, each a map of parameter name to a list of values,
/// and *that* is what makes a duplicated parameter detectable at all: a duplicate parses
/// cleanly and is refused by the layer that negotiates, not by the parser. A parser that
/// collapsed duplicates would have to decide policy, and policy belongs in negotiation.

import { scanConfiguration, skipWhitespace, syntax, unexpectedEnd } from "./scan";

export type ParsedExtension = {
  readonly name: string;
  /// One per `;` group, in the order they were written. A name with more than one entry
  /// is a duplicate, which the negotiator refuses rather than this.
  readonly parameters: Readonly<Record<string, readonly string[]>>;
};

export type ParsedExtensions = ReadonlyMap<string, readonly ParsedExtension[]>;

/// Parses a `Sec-WebSocket-Extensions` header value.
///
/// Throws a `SyntaxError` on anything the grammar does not allow, which is what the
/// callers turn into the `ws` refusal: a 400 on the server and a handshake abort on the
/// client. The message names the index, because "Invalid Sec-WebSocket-Extensions
/// header" with no position is the difference between a five-minute and a five-hour
/// diagnosis.
export function parseExtensions(header: string): ParsedExtensions {
  const out = new Map<string, ParsedExtension[]>();
  // Not skipped first: `ws`'s scanner refuses a header that opens with whitespace, since
  // it accepts whitespace only once a token has started. Matching that keeps a header
  // `ws` would answer with a 400 from being negotiated here.
  let index = 0;
  while (index < header.length) {
    const scanned = scanConfiguration(header, index);
    const extension: ParsedExtension = { name: scanned.name, parameters: scanned.parameters };
    index = skipWhitespace(header, scanned.rest);
    if (index < header.length) {
      if (header.charCodeAt(index) !== COMMA) {
        throw syntax(header, index, "expected ',' between extensions");
      }
      index = skipWhitespace(header, index + 1);
    }
    const existing = out.get(extension.name);
    if (existing === undefined) out.set(extension.name, [extension]);
    else existing.push(extension);
  }
  if (out.size === 0) throw unexpectedEnd(header, 0);
  return out;
}

const COMMA = 0x2c;
