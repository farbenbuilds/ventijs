/// The comment budget, in its own module because it is the only check that reads a
/// file as more than a list of lines.
///
/// A comment says why, in one or two sentences. The 150-line budget alone did not stop
/// the opposite: a file of 80 lines can be 70 of them and still pass, and a doc comment
/// that restates the identifier is worse than none, because it has to be read and it
/// goes stale. Two numbers, because the run cap is what catches a module essay and the
/// ratio is what catches a file commented uniformly and quietly.

const MAX_COMMENT_RATIO = 0.45;
const MAX_COMMENT_RUN = 10;

/// A file whose whole content is declarations -- compiled capacities, an error
/// vocabulary, a small record -- cannot carry a ratio, because the comments are why
/// the file exists. Exempting them by name would rot; exempting by shape does not.
const DECLARATION_FILE_MIN_CODE = 20;

export function commentViolations(name, source, violations) {
  const flags = commentLines(source);
  const comments = flags.filter(Boolean).length;
  const code = source.split("\n").filter((line) => line.trim() !== "").length - comments;
  const longest = longestRun(flags);
  if (longest > MAX_COMMENT_RUN) {
    violations.push(
      `${name}: ${longest} consecutive comment lines exceeds the ${MAX_COMMENT_RUN}-line run budget`,
    );
  }
  if (code >= DECLARATION_FILE_MIN_CODE && comments / code > MAX_COMMENT_RATIO) {
    violations.push(
      `${name}: ${comments} comment lines for ${code} code lines exceeds the ${MAX_COMMENT_RATIO} ratio`,
    );
  }
}

/// One entry per source line, `true` when the line is a comment. Kept positionally
/// because a run is a property of adjacency, and `false` is the terminator that
/// `commentLines` alone would drop. A `/*` block is one comment line per line it
/// spans and an unterminated one runs to the end of the file.
function commentLines(source) {
  const flags = [];
  let inBlock = false;
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (inBlock) {
      flags.push(true);
      if (line.includes("*/")) inBlock = false;
      continue;
    }
    if (line.startsWith("//")) {
      flags.push(true);
      continue;
    }
    if (line.startsWith("/*")) {
      flags.push(true);
      if (!line.includes("*/")) inBlock = true;
      continue;
    }
    flags.push(false);
  }
  return flags;
}

function longestRun(flags) {
  let longest = 0;
  let run = 0;
  for (const flag of flags) {
    run = flag ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  return longest;
}
