import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const OUT = path.join(ROOT, "out");

export function rel(abs: string) {
  return path.relative(ROOT, abs).split(path.sep).join("/");
}

// Minimal glob: "**" spans directories, "*" stays within one segment.
export function matchGlob(pattern: string, file: string) {
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${re}$`).test(file);
}
