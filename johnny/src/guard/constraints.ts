import fs from "node:fs";
import path from "node:path";
import { ROOT, matchGlob } from "../paths";

interface Constraints { protected_paths: string[]; editable_paths: string[]; prototype_paths: string[]; required_checks: string[] }

export const constraints: Constraints = JSON.parse(fs.readFileSync(path.join(ROOT, "constraints.json"), "utf8"));

export function isProtected(file: string) {
  return constraints.protected_paths.some((p) => matchGlob(p, file));
}

// Enforced in code, not only in the prompt: a plan touching a file outside
// editable_paths, or inside protected_paths, is rejected before any edit runs.
export function checkPlan(files: string[]): { ok: boolean; violations: string[] } {
  const violations = files.filter((f) => isProtected(f) || !constraints.editable_paths.some((p) => matchGlob(p, f)));
  return { ok: violations.length === 0, violations };
}
