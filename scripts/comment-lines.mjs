const LINE_COMMENT = "//";
const BLOCK_OPEN = "/*";
const BLOCK_CLOSE = "*/";

/// The line classifier, in its own module because it is the only place the gate reads
/// JavaScript or Zig as source rather than as text. The budget that calls it is in
/// `comment-budget.mjs`.
///
/// One entry per source line: `true` for a comment, `false` for code, `null` for a blank
/// line, which is neither and so counts as neither. Kept positionally because a run is a
/// property of adjacency, and a blank line ends one: two items each with a doc comment
/// are not one essay however adjacent the file makes them.
///
/// A `//` or `/*` anywhere on the line marks it, not only one that starts with it: a
/// trailing `// the index` is the form the rule most wants gone, and a check that only
/// saw whole-line comments missed every instance of it. Anywhere but inside a string or
/// a regex, which is why this walks the characters. A glob written as
/// `"tests/autobahn/**"` contains `/*` and a token regex contains `'`, and a substring
/// test read the first as a block comment that swallowed the file and the second as a
/// string that stayed open to the end of it.
export function commentLines(source) {
  const flags = [];
  let inBlock = false;
  for (const raw of source.split("\n")) {
    let sawComment = false;
    let quote = null;
    let inRegex = false;
    let index = 0;
    while (index < raw.length) {
      const char = raw[index];
      const pair = raw.slice(index, index + 2);
      if (inBlock) {
        sawComment = true;
        if (pair === BLOCK_CLOSE) inBlock = false;
      } else if (inRegex) {
        // A `/` ends the regex unless it is the escaped one in a character class.
        if (char === "\\") index += 1;
        else if (char === "/") inRegex = false;
      } else if (quote !== null) {
        if (char === "\\") index += 1;
        else if (char === quote) quote = null;
      } else if (pair === LINE_COMMENT || pair === BLOCK_OPEN) {
        sawComment = true;
        if (pair === BLOCK_OPEN && !raw.includes(BLOCK_CLOSE, index + 2)) inBlock = true;
        break;
      } else if (char === "/" && startsRegex(raw, index)) {
        inRegex = true;
      } else if (char === "'" || char === '"' || char === "`") {
        quote = char;
      }
      index += 1;
    }
    if (raw.trim() === "") flags.push(null);
    else flags.push(sawComment);
  }
  return flags;
}

/// Whether the `/` at `index` opens a regex rather than dividing: only a position that
/// cannot already be a value can, which is after an operator, a bracket, a comma, or
/// nothing. A `//` is a comment either way, so this never hides one.
function startsRegex(line, index) {
  const previous = line[index - 1];
  if (previous === undefined || previous === " " || previous === "\t") return true;
  return !/[A-Za-z0-9_$)\]]/.test(previous);
}
