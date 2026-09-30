/// The comment budget, in its own module because it is the only check that reads a
/// file as more than a list of lines.
///
/// A comment says why, in one or two sentences. The 150-line budget alone did not stop
/// the opposite: a file of 80 lines can be 70 of them and still pass, and a doc comment
/// that restates the identifier is worse than none, because it has to be read and it
/// goes stale. Two numbers, because the run cap is what catches a module essay and the
/// density cap catches a file commented uniformly and quietly.
import { commentLines } from "./comment-lines.mjs";

/// Source budgets, which are what the rule in `AGENTS.md` actually asks for. Zig gets a
/// looser density cap because the language requires the comment: every `pub` item is
/// documented, so a six-function module cannot carry 0.3. The run cap is unchanged,
/// because a doc comment on every item is restating identifiers, and the rule that a
/// comment must give a byte value, an invariant, or a divergence applies to Zig too.
const SOURCE_DENSITY = 0.3;
const SOURCE_RUN = 6;
const ZIG_DENSITY = 0.45;

/// Tests are looser because a fixture is where a wire byte value is documented, and the
/// rule allows "a byte value and its reason". A test that explains the octets it sends
/// has more to explain than a module has.
const TEST_DENSITY = 0.45;
const TEST_RUN = 10;

const TEST_PREFIX = "tests/";

/// Below this many code lines a ratio is not a usable budget, because a documented
/// declaration table of a dozen items would need 4 comment lines per code line to pass.
/// The cap becomes an absolute count instead. Exempting small files by name would rot;
/// exempting them by shape does not.
const RATIO_MIN_CODE = 40;

/// The allowance for a file too small for a ratio, as two numbers. The ceiling stops a
/// short file becoming an essay; the floor of six is a module doc and a few field docs,
/// because a file that is mostly declarations cannot meet any ratio and must still be
/// allowed to say what its numbers are.
const MAX_COMMENT_LINES = 24;
const MIN_COMMENT_LINES = 6;

export function commentViolations(name, source, violations) {
  zigModuleDocInTypeScript(name, source, violations);
  const isTest = name.startsWith(TEST_PREFIX);
  const density = isTest ? TEST_DENSITY : name.endsWith(".zig") ? ZIG_DENSITY : SOURCE_DENSITY;
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
  violations.push(...densityViolations(name, source, comments, code, density));
}

/// One budget whatever the file's size, so the two regimes cannot disagree. A file
/// large enough for a ratio is held to it. A small one is held to a band instead, because
/// the ratio is not a usable budget for six declarations: taking it literally would cap a
/// capacity table at two comment lines, which is a loophole in the other direction, and
/// taking the absolute cap alone would let a short file carry 24 lines of prose. Neither
/// number here is a judgement about a particular file; both are the shape of the rule.
function densityViolations(name, source, comments, code, density) {
  if (isDeclarationTable(name, source, code)) return [];
  const allowed = code >= RATIO_MIN_CODE ? Math.ceil(code * density) : smallFileBudget(code);
  if (comments > allowed) {
    const message =
      code >= RATIO_MIN_CODE
        ? `${name}: ${comments} comment lines for ${code} code lines exceeds the ${density} density`
        : `${name}: ${comments} comment lines in a ${code}-code-line file exceeds ${allowed}`;
    return [message];
  }
  return [];
}

/// `//!` is Zig's module-doc sigil, not TypeScript's, and a `.ts` file carrying one has
/// copied a form the language does not have; `///` is what the source tree uses.
function zigModuleDocInTypeScript(name, source, violations) {
  if (!/\.(?:ts|mts|cts)$/.test(name)) return;
  if (!source.split("\n").some((line) => line.startsWith("//!"))) return;
  violations.push(`${name}: uses Zig's //! module doc in TypeScript`);
}

/// A capacity table: every code line declares a constant, and every constant carries one
/// line saying what the number is and why. That is the rule's own example of what a
/// comment is for, and no ratio expresses it, because the file is almost all declarations
/// and deleting a constant's reason to satisfy a ratio is the wrong trade. Recognised by
/// shape rather than by name, so a new capacity table is covered and a renamed one is not
/// special-cased.
function isDeclarationTable(name, source, code) {
  if (!name.endsWith(".zig")) return false;
  const lines = source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("//") && !line.startsWith("///"));
  const declarations = lines.filter((line) => /^(pub )?const /.test(line));
  return declarations.length === code && declarations.length >= 4;
}

/// The band for a file below the ratio floor: never fewer than a module doc, never more
/// than the ceiling, and never more than the density would allow for a file this size
/// once it is big enough for the ratio to mean anything.
function smallFileBudget(code) {
  return Math.min(MAX_COMMENT_LINES, Math.max(MIN_COMMENT_LINES, Math.ceil(code * SOURCE_DENSITY)));
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
