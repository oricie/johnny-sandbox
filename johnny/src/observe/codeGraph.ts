import fs from "node:fs";
import path from "node:path";
import { Node, Project, SyntaxKind, type SourceFile } from "ts-morph";
import { ROOT, rel } from "../paths";
import type { BackendRoute, CodeGraph, CodeNode, FileKind, RouteEntry } from "../types";

const APP_SRC = path.join(ROOT, "demo-app/src");
const API_SRC = path.join(ROOT, "demo-api/src");

function kindOf(file: string): FileKind {
  if (file.includes("/screens/")) return "screen";
  if (file.includes("/components/")) return "component";
  if (file.includes("/api/")) return "api-client";
  if (file.endsWith("/App.tsx")) return "route-table";
  if (file.includes("/data/")) return "data";
  return "other";
}

// "/api/scenarios/${id}/lines" and "/api/scenarios/:id/lines" both become "/api/scenarios/:param/lines".
export function normalizeApiPath(p: string) {
  return p.replace(/\$\{[^}]+\}/g, ":param").replace(/:\w+/g, ":param");
}

// For each exported function in the API client, which endpoints it calls.
function apiFunctions(sf: SourceFile): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const fn of sf.getFunctions()) {
    const name = fn.getName();
    if (!name || !fn.isExported()) continue;
    const text = fn.getText();
    const method = /method:\s*"(\w+)"/.exec(text)?.[1] ?? "GET";
    const literals = fn
      .getDescendants()
      .filter((d) => Node.isStringLiteral(d) || Node.isNoSubstitutionTemplateLiteral(d) || Node.isTemplateExpression(d))
      .map((d) => d.getText().slice(1, -1))
      .filter((t) => t.startsWith("/api"));
    out[name] = literals.map((l) => `${method} ${normalizeApiPath(l)}`);
  }
  return out;
}

function routesFrom(sf: SourceFile): RouteEntry[] {
  const decl = sf.getVariableDeclaration("routes");
  const arr = decl?.getInitializerIfKind(SyntaxKind.ArrayLiteralExpression);
  if (!arr) return [];
  return arr.getElements().flatMap((el) => {
    if (!Node.isObjectLiteralExpression(el)) return [];
    const get = (k: string) => el.getProperty(k)?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
    const p = get("path")?.getText().slice(1, -1);
    const screen = get("screen")?.getText();
    if (!p || !screen) return [];
    const imp = sf.getImportDeclarations().find((i) => i.getNamedImports().some((n) => n.getName() === screen));
    const file = imp?.getModuleSpecifierSourceFile();
    return [{ path: p, screen, file: file ? rel(file.getFilePath()) : "?" }];
  });
}

function backendRoutes(): BackendRoute[] {
  const out: BackendRoute[] = [];
  for (const f of fs.readdirSync(API_SRC, { recursive: true }) as string[]) {
    if (!f.endsWith(".js")) continue;
    const abs = path.join(API_SRC, f);
    const text = fs.readFileSync(abs, "utf8");
    // Imported names -> module, so each handler links only to the modules it calls.
    const imported = [...text.matchAll(/import\s*\{([^}]+)\}\s*from\s+"(\.[^"]+)"/g)].flatMap((m) =>
      m[1].split(",").map((n) => ({ name: n.trim(), file: rel(path.resolve(path.dirname(abs), m[2])) })),
    );
    const handlers = [...text.matchAll(/"(GET|POST|PATCH|PUT|DELETE) (\/api[^"]*)"/g)];
    handlers.forEach((m, i) => {
      const body = text.slice(m.index, handlers[i + 1]?.index ?? text.length);
      const uses = [...new Set(imported.filter((imp) => body.includes(`${imp.name}(`)).map((imp) => imp.file))];
      out.push({ route: `${m[1]} ${normalizeApiPath(m[2])}`, file: rel(abs), uses });
    });
  }
  return out;
}

export function buildCodeGraph(): CodeGraph {
  const project = new Project({ tsConfigFilePath: path.join(ROOT, "demo-app/tsconfig.json") });
  const files = project.getSourceFiles().filter((sf) => sf.getFilePath().startsWith(APP_SRC));

  const clientFns: Record<string, Record<string, string[]>> = {};
  for (const sf of files) if (kindOf(sf.getFilePath()) === "api-client") clientFns[rel(sf.getFilePath())] = apiFunctions(sf);

  const nodes: Record<string, CodeNode> = {};
  for (const sf of files) {
    const file = rel(sf.getFilePath());
    const imports: string[] = [];
    const apiCalls = new Set<string>();
    for (const imp of sf.getImportDeclarations()) {
      const target = imp.getModuleSpecifierSourceFile();
      if (!target) continue;
      const t = rel(target.getFilePath());
      imports.push(t);
      for (const n of imp.getNamedImports()) for (const call of clientFns[t]?.[n.getName()] ?? []) apiCalls.add(call);
    }
    nodes[file] = {
      file,
      kind: kindOf(sf.getFilePath()),
      exports: [...sf.getExportedDeclarations().keys()],
      imports,
      apiCalls: [...apiCalls],
    };
  }

  const appFile = files.find((sf) => sf.getFilePath().endsWith("/App.tsx"));
  return { nodes, routes: appFile ? routesFrom(appFile) : [], backend: backendRoutes() };
}

// Every app file reachable from `file` through imports, including itself.
export function reachable(graph: CodeGraph, file: string): string[] {
  const seen = new Set<string>();
  const stack = [file];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f) || !graph.nodes[f]) continue;
    seen.add(f);
    stack.push(...graph.nodes[f].imports);
  }
  return [...seen];
}
