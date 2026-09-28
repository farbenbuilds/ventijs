/// The comment budget, in its own module because it is the only check that reads a
/// file as more than a list of lines.
///
/// A comment says why, in one or two sentences. The 150-line budget alone did not stop
/// the opposite: a file of 80 lines can be 70 of them and still pass, and a doc comment
/// that restates the identifier is worse than none, because it has to be read and it
/// goes stale. Two numbers, because the run cap is what catches a module essay and the
/// ratio is what catches a file commented uniformly and quietly.

/// Source budgets. The rule the repo states is about the code that ships, and the whole
/// of `src/` meets these, so they are set at what the rule actually permits rather than
/// at what would need a mass trim to become true.
const SOURCE_RATIO = 0.3;
const SOURCE_RUN = 6;

/// Test budgets, and the reason they are looser: a test fixture is where a wire byte
/// value is documented, and the rule explicitly allows "a byte value and its reason".
/// A test that explains the octets it sends has more to explain than a module has.
const TEST_RATIO = 0.45;
const TEST_RUN = 10;

const TEST_PREFIX = "tests/";

/// Zig gets a cap of its own because the language requires the comment: a Zig file
/// documents every `pub` declaration, and the six `pub fn`s of a small module cannot
/// carry a 0.3 ratio. The run cap still applies, because a doc comment on every item is
/// restating identifiers, and the source rule that comments must explain a byte value,
/// an invariant, or a divergence is unchanged. Measured over private lines as well, so
/// the ratio is not flattered by counting only what it must document.
const ZIG_RATIO = 0.45;

/// The ratio is meaningless on a small file, and every small file fails it: a Zig
/// `pub fn` must be documented, so a 6-function module cannot carry 0.3. Under this
/// floor the budget is an absolute count instead, which measures the thing the ratio
/// was standing in for -- how much prose a reader has to get through. Exempting small
/// files by name would rot; exempting them by shape does not.
const RATIO_MIN_CODE = 40;

/// An absolute budget for a file too small for a ratio. Set above the heaviest
/// declaration file in `src/` (a capacity table that records why each number is what it
/// is) so the floor is a measurement rather than a loophole.
const MAX_COMMENT_LINES = 24;

const LINE_COMMENT = "//";
const BLOCK_OPEN = "/*";
const BLOCK_CLOSE = "*/";

export function commentViolations(name, source, violations) {
  const isTest = name.startsWith(TEST_PREFIX);
  const isZig = name.endsWith(".zig");
  const ratio = isZig ? ZIG_RATIO : isTest ? TEST_RATIO : SOURCE_RATIO;
  const run = isTest ? TEST_RUN : SOURCE_RUN;
  const flags = commentLines(source);
  const comments = flags.filter((flag) => flag === true).length;
  const code = flags.filter((flag) => flag !== null).length - comments;
  const longest = longestRun(flags);
  if (longest > run) {
    violations.push(
      `${name}: ${longest} consecutive comment lines exceeds the ${run}-line run budget`,
    );
  }
  if (code < RATIO_MIN_CODE) {
    if (comments > MAX_COMMENT_LINES) {
      violations.push(
        `${name}: ${comments} comment lines in a ${code}-line file exceeds ${MAX_COMMENT_LINES}`,
      );
    }
    return;
  }
  if (comments / code > ratio) {
    violations.push(
      `${name}: ${comments} comment lines for ${code} code lines exceeds the ${ratio} ratio`,
    );
  }
}

/// One entry per source line: `true` for a comment, `false` for code, `null` for a blank
/// line, which is neither and so counts as neither. Kept positionally because a run is a
/// property of adjacency, and a blank line ends one: two items each with a doc comment
/// are not one essay however adjacent the file makes them.
///
/// A `//` or `/*` anywhere on the line marks it, not only one that starts with it: a
/// trailing `// the index` is the form the rule most wants gone, and a check that only
/// saw whole-line comments missed every instance of it. Anywhere but inside a string,
/// which is why this walks the characters: a glob written as `"tests/autobahn/**"`
/// contains `/*`, and a substring test read it as a block comment that then swallowed
/// the rest of the file.
function commentLines(source) {
  const flags = [];
  let inBlock = false;
  let quote = null;
  for (const raw of source.split("\n")) {
    let sawComment = false;
    let index = 0;
    while (index < raw.length) {
      const pair = raw.slice(index, index + 2);
      if (inBlock) {
        sawComment = true;
        if (pair === BLOCK_CLOSE) inBlock = false;
      } else if (quote !== null) {
        if (raw[index] === "\\") index += 1;
        else if (raw[index] === quote) quote = null;
      } else if (pair === LINE_COMMENT || pair === BLOCK_OPEN) {
        sawComment = true;
        if (pair === BLOCK_OPEN && !raw.includes(BLOCK_CLOSE, index + 2)) inBlock = true;
      } else if (raw[index] === "'" || raw[index] === '"' || raw[index] === "`") {
        quote = raw[index];
      }
      index += 1;
    }
    if (raw.trim() === "") flags.push(null);
    else flags.push(sawComment);
  }
  return flags;
}

function longestRun(flags) {
  let longest = 0;
  let run = 0;
  for (const flag of flags) {
    if (flag === null) {
      run = 0;
      continue;
    }
    run = flag ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  return longest;
}
