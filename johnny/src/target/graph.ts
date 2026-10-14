import fs from "node:fs";
import path from "node:path";
import { Project } from "ts-morph";

export interface RouteInfo {
  route: string; // e.g. /websites/[websiteId]/funnels
  page: string; // repo-relative page.tsx
  files: string[]; // reachable app files in BFS order (page first)
  lines: number;
}

// Next.js app router: every src/app/**/page.tsx is a route. Route groups "(x)" and
// parallel/intercepting segments are dropped from the URL.
function routeOf(rel: string) {
  const parts = path.dirname(rel).split("/").slice(2) // drop "src/app"
    .filter((p) => !/^\(.*\)$/.test(p) && !p.startsWith("@") && !p.startsWith("(."));
  return "/" + parts.join("/");
}

export function buildRouteGraph(root: string): RouteInfo[] {
  const project = new Project({ tsConfigFilePath: path.join(root, "tsconfig.json"), skipFileDependencyResolution: true });
  const src = path.join(root, "src") + path.sep;
  const rel = (abs: string) => path.relative(root, abs).split(path.sep).join("/");
  const imports = new Map<string, string[]>();
  for (const sf of project.getSourceFiles()) {
    if (!sf.getFilePath().startsWith(src)) continue;
    imports.set(rel(sf.getFilePath()), sf.getImportDeclarations()
      .map((i): string | undefined => i.getModuleSpecifierSourceFile()?.getFilePath())
      .filter((p): p is string => !!p && p.startsWith(src))
      .map(rel));
  }
  const lines = (f: string) => fs.readFileSync(path.join(root, f), "utf8").split("\n").length;

  return [...imports.keys()]
    .filter((f) => /^src\/app\/.*page\.tsx$/.test(f) && !f.includes("/@modal/"))
    .map((page) => {
      const seen: string[] = [];
      const queue = [page];
      while (queue.length) {
        const f = queue.shift()!;
        if (seen.includes(f) || !imports.has(f)) continue;
        seen.push(f);
        queue.push(...imports.get(f)!);
      }
      return { route: routeOf(page), page, files: seen, lines: seen.reduce((n, f) => n + lines(f), 0) };
    })
    .sort((a, b) => a.route.localeCompare(b.route));
}
