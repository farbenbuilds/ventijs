// The `commit-msg` hook is the only thing standing between a squash merge and a push
// GitHub reads as "skip all CI". It cannot be tested through CI, because a skipped push
// starts no workflow -- so the check is a script, and a script that has never been run is
// a rule nobody has.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const SCRIPT = fileURLToPath(new URL("../../scripts/check-commit-msg.mjs", import.meta.url));

/// The message file git hands a `commit-msg` hook: the message, then comment lines
/// git has not stripped yet. Comments have to be ignored, or every commit fails.
function run(message: string): { readonly code: number; readonly out: string } {
  const dir = mkdtempSync(join(tmpdir(), "ventiws-msg-"));
  const file = join(dir, "COMMIT_EDITMSG");
  writeFileSync(
    file,
    `${message}\n# Please enter the commit message for your changes.\n# On branch main\n`,
  );
  try {
    return {
      code: 0,
      out: execFileSync(process.execPath, [SCRIPT, file], { encoding: "utf8", stdio: "pipe" }),
    };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failed.status ?? 1, out: `${failed.stdout ?? ""}${failed.stderr ?? ""}` };
  }
}

test("a conventional message passes", () => {
  const result = run("fix(compat): a socket state that could not be reached\n\nBody text.");
  expect(result.code).toBe(0);
});

test("every marker form is refused", () => {
  // All five, because GitHub recognises all five and a hook that knows four is a hook that
  // works until the fifth is used.
  for (const marker of ["skip ci", "ci skip", "no ci", "skip actions", "actions skip"]) {
    expect(run(`docs: explain [${marker}]\n\nBody.`).code, marker).not.toBe(0);
  }
});

test("a marker in the body is refused, not only in the subject", () => {
  // The squash case: the marker arrives in a body, several commits after the one that
  // mentions it, concatenated into the message on main.
  const result = run("docs: describe the release\n\nThe commit carries [skip ci] because...");
  expect(result.code).not.toBe(0);
});

test("a refusal says how to recover", () => {
  // The failure is invisible from CI, so the only chance to explain it is here.
  const result = run("docs: x\n\n[skip ci]");
  expect(result.out).toContain("gh workflow run bump.yml");
});

test("a body that describes the marker is refused as well, because GitHub cannot tell", () => {
  // GitHub matches the literal string anywhere in a message, so neither GitHub nor this
  // hook can distinguish a commit that *uses* the marker from one that writes about it. A
  // commit that genuinely has to quote it breaks the brackets: `[skip ci`. Asserting the
  // limitation is the point, since a hook that claimed to be cleverer would be wrong.
  expect(run("docs: a note on [skip ci] markers\n\nThis commit carries none.").code).not.toBe(0);
});
