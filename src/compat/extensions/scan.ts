/// The scanner behind the extension header grammar. Kept apart from the grammar because
/// a scanner change that alters a refusal is a compatibility change, and a grammar change
/// that stops refusing something is one too.

/// RFC 6455 section 9.1 `tchar`, which a parameter name and an unquoted value both
/// have to be.
const TOKEN = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;

const COMMA = 0x2c;
const SEMICOLON = 0x3b;
const EQUALS = 0x3d;
const QUOTE = 0x22;

export const isWhitespace = (code: number): boolean => code === 0x20 || code === 0x09;

/// A comma ends the *configuration*, not the extension: `permessage-deflate; a,
/// permessage-deflate; b` is two offers of one name, and RFC 7692 section 7.1.1.1 lets a
/// client send exactly that so a server with a narrow window can be offered a second
/// configuration after the first is declined.
export type ScannedConfiguration = {
  readonly name: string;
  readonly parameters: Readonly<Record<string, readonly string[]>>;
  readonly rest: number;
};

export function scanConfiguration(header: string, start: number): ScannedConfiguration {
  const name = readToken(header, start, "an extension name");
  if (name === null) throw unexpectedEnd(header, start);
  const parameters: Record<string, string[]> = {};
  let index = start + name.length;
  for (;;) {
    index = skipWhitespace(header, index);
    if (index >= header.length || header.charCodeAt(index) === COMMA) break;
    if (header.charCodeAt(index) !== SEMICOLON) {
      throw syntax(header, index, "expected ';' or ','");
    }
    const afterSemicolon = skipWhitespace(header, index + 1);
    // A trailing `;` names no parameter, which `ws` tolerates: a semicolon separates
    // parameters rather than ending the list.
    if (afterSemicolon >= header.length) {
      index = afterSemicolon;
      break;
    }
    index = readParameter(header, index, parameters);
  }
  return { name, parameters, rest: index };
}

/// Reads one `; name` or `; name=value` group, returning the index after it.
function readParameter(header: string, start: number, into: Record<string, string[]>): number {
  const nameStart = skipWhitespace(header, start + 1);
  const name = readToken(header, nameStart, "a parameter name");
  if (name === null) throw unexpectedEnd(header, nameStart);
  const afterEquals = skipWhitespace(header, nameStart + name.length);
  if (header.charCodeAt(afterEquals) !== EQUALS) {
    push(into, name, "");
    return afterEquals;
  }
  const value = readValue(header, skipWhitespace(header, afterEquals + 1));
  push(into, name, value.value);
  // The end of the scan, not `afterEquals + 1 + width`: whitespace is allowed after the
  // `=`, so adding a width to the position of the `=` walks the index back into the value
  // and reports a parse error on a header `ws` reads without complaint.
  return value.end;
}

function push(into: Record<string, string[]>, name: string, value: string): void {
  const existing = into[name];
  if (existing === undefined) into[name] = [value];
  else existing.push(value);
}

/// A parameter value, which is a token or a quoted string: the unescaped value and the
/// index just past it.
type ReadValue = { readonly value: string; readonly end: number };

function readValue(header: string, start: number): ReadValue {
  if (header.charCodeAt(start) !== QUOTE) {
    const token = readToken(header, start, "a parameter value");
    if (token === null) throw unexpectedEnd(header, start);
    if (!TOKEN.test(token)) throw syntax(header, start, "invalid parameter value");
    return { value: token, end: start + token.length };
  }
  let index = start + 1;
  let value = "";
  for (;;) {
    if (index >= header.length) throw unexpectedEnd(header, start);
    const char = header[index] as string;
    if (char === "\\") {
      const escaped = header[index + 1];
      if (escaped === undefined) throw unexpectedEnd(header, index);
      value += escaped;
      index += 2;
      continue;
    }
    // Unescaped without a second look, which is `ws`: RFC 6455 section 9.1.5 unescapes
    // into the value and nothing re-validates it. It cannot reach a response header
    // either, because a quoted value only matters to a parameter the negotiator already
    // knows, and a known `*_window_bits` parameter is a number it has to parse anyway.
    if (char === '"') return { value, end: index + 1 };
    value += char;
    index += 1;
  }
}

/// A run of token characters, or null when there is none there.
function readToken(header: string, start: number, what: string): string | null {
  let index = start;
  while (index < header.length) {
    const code = header.charCodeAt(index);
    if (isWhitespace(code) || code === SEMICOLON || code === COMMA || code === EQUALS) break;
    if (code === QUOTE) throw syntax(header, index, `expected ${what}`);
    index += 1;
  }
  if (index === start) return null;
  return header.slice(start, index);
}

export function skipWhitespace(header: string, start: number): number {
  let index = start;
  while (index < header.length && isWhitespace(header.charCodeAt(index))) index += 1;
  return index;
}

export function syntax(header: string, at: number, detail: string): SyntaxError {
  return new SyntaxError(`Invalid Sec-WebSocket-Extensions header at ${at}: ${detail}`);
}

export function unexpectedEnd(header: string, at: number): SyntaxError {
  return new SyntaxError(`Unexpected end of Sec-WebSocket-Extensions header at ${at}`);
}
