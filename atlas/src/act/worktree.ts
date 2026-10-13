import { execFileSync } from "node:child_process";
import path from "node:path";
import { ROOT } from "../paths";

// One isolated worktree per option, so A and B can be built and screenshotted in parallel.
// Not wired into run.ts yet — next step is the act + verify stage.
export function createWorktree(option: "A" | "B") {
  const branch = `atlas/option-${option.toLowerCase()}`;
  const dir = path.join(ROOT, ".worktrees", branch.replace("/", "-"));
  execFileSync("git", ["worktree", "add", "-B", branch, dir], { cwd: ROOT, stdio: "inherit" });
  return { branch, dir };
}
