import fs from "node:fs";
import path from "node:path";
import { ts } from "ts-morph";
import type { RouteInfo } from "./graph";

// Route graph for a Next.js app inside a monorepo, without node_modules installed.
// Imports are read with a regex and resolved by hand: relative paths, the app's tsconfig
// "paths" and baseUrl, and workspace packages by their package.json name (and "exports").
// Type-only imports are skipped: they don't change what a screen renders.

const EXTS = ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", "/index.js"];
const IMPORT_RE = /^\s*(?:import|export)\s+(?!type\s)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/gm;

interface Pkg { name: string; dir: string; exports: Record<string, string> }

function readJson(file: string) {
  // tsconfig files allow comments and trailing commas, so let TypeScript parse them.
  return ts.parseConfigFileTextToJson(file, fs.readFileSync(file, "utf8")).config;
}

function workspacePackages(root: string): Pkg[] {
  const pkgs: Pkg[] = [];
  const walk = (dir: string, depth: number) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === "node_modules" || e.name.startsWith(".")) continue;
      const d = path.join(dir, e.name);
      const pj = path.join(d, "package.json");
      if (fs.existsSync(pj)) {
        const j = JSON.parse(fs.readFileSync(pj, "utf8"));
        const exports: Record<string, string> = {};
        if (j.exports && typeof j.exports === "object")
          for (const [k, v] of Object.entries(j.exports))
            if (typeof v === "string") exports[k] = v;
            else if (v && typeof v === "object") {
              const t = (v as Record<string, unknown>).types ?? (v as Record<string, unknown>).import ?? (v as Record<string, unknown>).default;
              if (typeof t === "string") exports[k] = t;
            }
        if (j.name) pkgs.push({ name: j.name, dir: d, exports });
      }
      if (depth < 2) walk(d, depth + 1);
    }
  };
  for (const top of ["packages", "apps"]) if (fs.existsSync(path.join(root, top))) walk(path.join(root, top), 1);
  return pkgs.sort((a, b) => b.name.length - a.name.length);
}

export function buildMonorepoGraph(root: string, appDir: string): RouteInfo[] {
  const appRoot = path.resolve(root, path.dirname(appDir)); // e.g. apps/web
  const tsconfig = readJson(path.join(appRoot, "tsconfig.json"));
  const baseUrl = path.resolve(appRoot, tsconfig.compilerOptions?.baseUrl ?? ".");
  const aliases = Object.entries((tsconfig.compilerOptions?.paths ?? {}) as Record<string, string[]>);
  const pkgs = workspacePackages(root);
  const rel = (abs: string) => path.relative(root, abs).split(path.sep).join("/");

  const file = (base: string) => {
    for (const ext of EXTS) {
      const f = base + ext;
      if (fs.existsSync(f) && fs.statSync(f).isFile() && /\.(tsx?|jsx?)$/.test(f)) return f;
    }
  };

  const resolve = (spec: string, from: string, depth = 0): string | undefined => {
    if (depth > 3) return;
    if (spec.startsWith(".")) return file(path.resolve(path.dirname(from), spec));
    for (const [pattern, targets] of aliases) {
      const prefix = pattern.replace(/\*$/, "");
      if (pattern.endsWith("*") ? !spec.startsWith(prefix) : spec !== pattern) continue;
      const rest = spec.slice(prefix.length);
      for (const t of targets) {
        const target = t.replace(/\*$/, rest);
        const hit = target.startsWith(".") ? file(path.resolve(baseUrl, target)) : resolve(target, from, depth + 1);
        if (hit) return hit;
      }
    }
    const pkg = pkgs.find((p) => spec === p.name || spec.startsWith(p.name + "/"));
    if (pkg) {
      const sub = "." + spec.slice(pkg.name.length);
      const exp = pkg.exports[sub === "." ? "." : sub];
      return (exp && file(path.resolve(pkg.dir, exp))) || file(path.join(pkg.dir, sub)) || file(path.join(pkg.dir, "src", sub));
    }
    return file(path.resolve(baseUrl, spec)); // bare paths under baseUrl, e.g. "app/_types"
  };

  const importsCache = new Map<string, string[]>();
  const importsOf = (abs: string) => {
    let hit = importsCache.get(abs);
    if (!hit) {
      const src = fs.readFileSync(abs, "utf8");
      const found = new Set<string>();
      for (const m of src.matchAll(IMPORT_RE)) {
        const r = resolve(m[1] ?? m[2], abs);
        if (r && !r.includes(`${path.sep}node_modules${path.sep}`)) found.add(r);
      }
      hit = [...found];
      importsCache.set(abs, hit);
    }
    return hit;
  };

  const app = path.resolve(root, appDir);
  const pages: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && !e.name.startsWith("@")) walk(p);
      else if (e.name === "page.tsx") pages.push(p);
    }
  };
  walk(app);

  const lineCount = new Map<string, number>();
  const lines = (abs: string) => {
    if (!lineCount.has(abs)) lineCount.set(abs, fs.readFileSync(abs, "utf8").split("\n").length);
    return lineCount.get(abs)!;
  };

  return pages.map((page) => {
    const seen = new Set<string>();
    const queue = [page];
    while (queue.length) {
      const f = queue.shift()!;
      if (seen.has(f)) continue;
      seen.add(f);
      queue.push(...importsOf(f));
    }
    const segments = path.relative(app, path.dirname(page)).split(path.sep)
      .filter((s) => s && !/^\(.*\)$/.test(s));
    const files = [...seen];
    return { route: "/" + segments.join("/"), page: rel(page), files: files.map(rel), lines: files.reduce((n, f) => n + lines(f), 0) };
  }).sort((a, b) => a.route.localeCompare(b.route));
}
