import { spawnSync } from "node:child_process";
import path from "node:path";
import { ROOT } from "../paths";

const BIN = path.join(ROOT, "node_modules/.bin");

// The same checks a contributor runs: typecheck and production build of demo-app.
export function runChecks(dir: string): { ok: boolean; output: string } {
  const app = path.join(dir, "demo-app");
  for (const [name, cmd, args] of [
    ["typecheck", path.join(BIN, "tsc"), ["--noEmit", "-p", "tsconfig.json"]],
    ["build", path.join(BIN, "vite"), ["build", "--logLevel", "error"]],
  ] as const) {
    const r = spawnSync(cmd, args, { cwd: app, encoding: "utf8" });
    if (r.status !== 0) return { ok: false, output: `${name} failed:\n${r.stdout}${r.stderr}`.slice(0, 6000) };
  }
  return { ok: true, output: "typecheck and build passed" };
}
