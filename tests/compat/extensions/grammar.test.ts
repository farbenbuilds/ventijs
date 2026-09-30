// The extension header grammar, in isolation.
//
// Its own module because this is the one piece of negotiation a peer can attack with
// nothing but bytes, and a hand-written recursive-descent parser is exactly the kind of
// code that is correct on the examples in its own documentation. Every case here is a
// shape RFC 6455 section 9.1 allows or a near miss of one.

import { describe, expect, test } from "vitest";
import { parseExtensions } from "../../../src/compat/extensions/grammar";
import { formatExtension } from "../../../src/compat/extensions/format";

/// The parameter list of the one configuration of `name`, or undefined when the header
/// did not carry one. Reading a two-level map in every assertion is noise.
function only(
  name: string,
  header: string,
): Readonly<Record<string, readonly string[]>> | undefined {
  return parseExtensions(header).get(name)?.[0]?.parameters;
}

describe("parseExtensions", () => {
  test("a bare name parses to no parameters", () => {
    expect(only("permessage-deflate", "permessage-deflate")).toEqual({});
  });

  test("a valueless parameter is present with an empty value", () => {
    // The distinction the whole normalizer rests on: RFC 7692's `client_max_window_bits`
    // with no value is a client saying it can take a window the server chooses, which is
    // not the same as the parameter being absent.
    expect(only("permessage-deflate", "permessage-deflate; client_max_window_bits")).toEqual({
      client_max_window_bits: [""],
    });
  });

  test("a valued parameter keeps its number", () => {
    expect(only("permessage-deflate", "permessage-deflate; client_max_window_bits=10")).toEqual({
      client_max_window_bits: ["10"],
    });
  });

  test("whitespace around the separators is ignored", () => {
    // Not at the very start, because `ws` refuses a header that opens with whitespace:
    // its scanner accepts whitespace only after a token has begun. Being more relaxed
    // there would mean a header `ws` answers with a 400 is negotiated instead.
    expect(
      only("permessage-deflate", "permessage-deflate ;  client_max_window_bits = 10 "),
    ).toEqual({
      client_max_window_bits: ["10"],
    });
  });

  test("two names are two entries", () => {
    const parsed = parseExtensions("permessage-deflate; a, x-webkit-deflate-frame");
    expect([...parsed.keys()]).toEqual(["permessage-deflate", "x-webkit-deflate-frame"]);
  });

  test("a repeated name is one list of configurations", () => {
    // `ws` parses it this way, and a server that offers two configurations of the same
    // extension so it can fall back to a second after declining the first depends on it.
    const parsed = parseExtensions("permessage-deflate; a=1, permessage-deflate; b=2");
    expect(parsed.get("permessage-deflate")).toHaveLength(2);
    expect(parsed.get("permessage-deflate")?.[1]?.parameters).toEqual({ b: ["2"] });
  });

  test("a second configuration starts with empty parameters", () => {
    // The parameters of the first must not leak into the second, which is a silent
    // negotiation bug rather than a parse error: a server would read an offer as
    // carrying a parameter it was never sent.
    const parsed = parseExtensions("permessage-deflate; a=1, permessage-deflate; b=2");
    expect(parsed.get("permessage-deflate")?.[0]?.parameters).toEqual({ a: ["1"] });
  });

  test("a quoted string is unescaped", () => {
    expect(only("x-test", 'x-test; p="a\\"b"')).toEqual({ p: ['a"b'] });
  });

  test("a trailing comma is accepted and names one extension", () => {
    // \`ws\` accepts it, so accepting it is the compatible answer rather than a lenient
    // one: a peer that gets a 400 here but connects to \`ws\` would look like a bug in the
    // peer, and there is no reason for that to be true.
    expect([...parseExtensions("permessage-deflate,").keys()]).toEqual(["permessage-deflate"]);
  });

  test.each(["permessage-deflate;", "permessage-deflate; "])(
    "a trailing semicolon is accepted and adds no parameter: %s",
    (header) => {
      expect(only("permessage-deflate", header)).toEqual({});
    },
  );

  test("a quoted value is unescaped without a second look, as ws does", () => {
    // RFC 7692's parameters are all tokens, so `a b` is not one, and `ws` accepts it
    // anyway: nothing re-validates the unescaped string. Refusing here would diverge
    // from the contract on a header that is harmless, because the negotiator refuses
    // unknown parameters and re-reads a known one as a number.
    expect(only("x-test", 'x-test; p="a b"')).toEqual({ p: ["a b"] });
  });

  test("an unquoted value that is not a token is refused", () => {
    // The unquoted form has no unescaping step, so a character outside the token grammar
    // is read here rather than turned into a value nobody could have meant.
    expect(() => parseExtensions("x-test; p=(1)")).toThrow(SyntaxError);
  });

  test("a duplicate parameter is kept, not collapsed", () => {
    // Collapsing here would make the duplicate undetectable, so the parser keeps both
    // and the negotiator refuses.
    expect(only("x-test", "x-test; p=1; p=2")).toEqual({ p: ["1", "2"] });
  });

  test.each([
    ["an empty header", ""],
    ["a leading comma", ",permessage-deflate"],
    ["leading whitespace", "  permessage-deflate"],
    ["a bare semicolon", ";"],
    ["a doubled separator", "permessage-deflate;;a"],
    ["a separator with no name", "permessage-deflate;;"],
    ["a quote where a token belongs", 'permessage-deflate; "'],
    ["an unterminated quoted string", 'permessage-deflate; p="a'],
    ["a dangling escape", 'permessage-deflate; p="a\\'],
  ])("%s is refused", (_name, header) => {
    expect(() => parseExtensions(header)).toThrow(SyntaxError);
  });

  test("the message names the position, because a refusal without one is a puzzle", () => {
    expect(() => parseExtensions("permessage-deflate; p=(1)")).toThrow(/at 2[0-9]:/);
  });
});

describe("formatExtension", () => {
  test("a valueless parameter is written as its own name", () => {
    // With an `=`, a peer reads `client_max_window_bits=` as 0, and 0 is not a legal
    // window size. This is the difference between a working header and a 400.
    expect(formatExtension("permessage-deflate", { client_max_window_bits: "" })).toBe(
      "permessage-deflate; client_max_window_bits",
    );
  });

  test("a valued parameter keeps its value", () => {
    expect(formatExtension("permessage-deflate", { client_max_window_bits: "10" })).toBe(
      "permessage-deflate; client_max_window_bits=10",
    );
  });

  test("a bare name round-trips through the parser", () => {
    const rendered = formatExtension("permessage-deflate", { server_no_context_takeover: "" });
    expect(only("permessage-deflate", rendered)).toEqual({ server_no_context_takeover: [""] });
  });
});
