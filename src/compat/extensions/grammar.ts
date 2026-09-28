/// The RFC 6455 extension header grammar, parsed. The shape is `ws`'s, deliberately: a
/// map of extension name to a list of configurations, each a map of parameter name to a
/// list of values. That is what makes a duplicated parameter detectable at all, since a
/// duplicate parses cleanly and is refused by the layer that negotiates.

import { scanConfiguration, skipWhitespace, syntax, unexpectedEnd } from "./scan";

export type ParsedExtension = {
  readonly name: string;
  /// One per `;` group, in the order written. More than one entry for a name is a
  /// duplicate, which the negotiator refuses rather than this.
  readonly parameters: Readonly<Record<string, readonly string[]>>;
};

export type ParsedExtensions = ReadonlyMap<string, readonly ParsedExtension[]>;

/// Throws a `SyntaxError` on anything the grammar does not allow, which the callers turn
/// into the `ws` refusal: a 400 on the server, a handshake abort on the client. The
/// message names the index, because an unpositioned one is a five-hour diagnosis.
export function parseExtensions(header: string): ParsedExtensions {
  const out = new Map<string, ParsedExtension[]>();
  // Not skipped first: `ws`'s scanner refuses a header that opens with whitespace, since
  // it accepts whitespace only once a token has started.
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
