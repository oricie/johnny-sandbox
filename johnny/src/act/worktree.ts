import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../paths";

// One isolated worktree per option, branched from the current HEAD, so A and B
// are built and screenshotted side by side without touching the main checkout.
export function createWorktree(option: string) {
  const branch = `johnny/option-${option.toLowerCase()}`;
  const dir = path.join(ROOT, ".worktrees", `option-${option.toLowerCase()}`);
  if (fs.existsSync(dir)) execFileSync("git", ["worktree", "remove", "--force", dir], { cwd: ROOT });
  execFileSync("git", ["worktree", "add", "-q", "-B", branch, dir, "HEAD"], { cwd: ROOT });
  // Reuse the main checkout's installed dependencies.
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"), "dir");
  return { branch, dir };
}

export function commitAll(dir: string, message: string) {
  const env = { ...process.env, GIT_AUTHOR_NAME: "Johnny", GIT_AUTHOR_EMAIL: "johnny@example.invalid",
    GIT_COMMITTER_NAME: "Johnny", GIT_COMMITTER_EMAIL: "johnny@example.invalid" };
  execFileSync("git", ["add", "-A", "demo-app/src"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: dir, env });
  return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: dir }).toString().trim();
}
