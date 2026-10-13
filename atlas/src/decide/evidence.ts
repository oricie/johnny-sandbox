import { matchGlob } from "../paths";
import { reachable } from "../observe/codeGraph";
import { isProtected } from "../guard/constraints";
import type { CodeGraph, EvidencePack, KnowledgeDoc, Signal } from "../types";

// Joins the four layers per screen: signals -> route -> screen file -> components ->
// API calls -> backend handlers -> knowledge whose scope covers any of those files.
export function buildEvidencePacks(graph: CodeGraph, knowledge: KnowledgeDoc[], signals: Signal[]): EvidencePack[] {
  return graph.routes.map((route) => {
    const appFiles = reachable(graph, route.file);
    const apiCalls = [...new Set(appFiles.flatMap((f) => graph.nodes[f].apiCalls))];
    const handlers = graph.backend.filter((b) => apiCalls.includes(b.route));
    const backendFiles = [...new Set(handlers.flatMap((h) => [h.file, ...h.uses]))];
    const allFiles = [...appFiles, ...backendFiles];

    return {
      screen: route.path,
      screenFile: route.file,
      components: appFiles.filter((f) => f !== route.file && graph.nodes[f].kind === "component"),
      apiCalls,
      backendFiles,
      signals: signals.filter((s) => s.screen === route.path),
      knowledge: knowledge.filter((k) => k.scope.some((p) => allFiles.some((f) => matchGlob(p, f)))),
      protectedFiles: allFiles.filter(isProtected),
    };
  });
}
