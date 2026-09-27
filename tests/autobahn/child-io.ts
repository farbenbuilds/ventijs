import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

/// Pipes of a child started with `stdio: ["ignore", "pipe", "pipe"]`.
export type TargetChild = ChildProcessByStdio<null, Readable, Readable>;

/// A chunk boundary is not a line boundary: a single write can carry several
/// lines and one line can arrive in several writes. Both helpers hold the
/// trailing partial line until the next chunk completes it.
function consume(buffer: string, chunk: string, onLine: (line: string) => void): string {
  const parts = (buffer + chunk).split("\n");
  const rest = parts.pop() ?? "";
  for (const line of parts) onLine(line);
  return rest;
}

export function readLines(child: TargetChild, onLine: (line: string) => void): void {
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer = consume(buffer, chunk, onLine);
  });
  child.stdout.on("end", () => {
    if (buffer.length > 0) onLine(buffer);
  });
}

/// Echoes the child's stderr into the runner's log and returns the collected
/// lines, so a failure before the ready record can explain itself.
export function forwardStderr(child: TargetChild): readonly string[] {
  const lines: string[] = [];
  let buffer = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    buffer = consume(buffer, chunk, (line) => {
      lines.push(line);
      process.stderr.write(`ventijs-target: ${line}\n`);
    });
  });
  return lines;
}
