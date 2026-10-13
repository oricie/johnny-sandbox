export type FileKind = "screen" | "component" | "api-client" | "route-table" | "data" | "style" | "backend" | "other";

export interface CodeNode {
  file: string; // repo-relative
  kind: FileKind;
  exports: string[];
  imports: string[]; // repo-relative files
  apiCalls: string[]; // e.g. "GET /api/scenarios"
}

export interface RouteEntry { path: string; screen: string; file: string }
export interface BackendRoute { route: string; file: string; uses: string[] }

export interface CodeGraph {
  nodes: Record<string, CodeNode>;
  routes: RouteEntry[];
  backend: BackendRoute[];
}

export interface KnowledgeDoc {
  id: string; // e.g. "decisions.md#D-12"
  type: string;
  title: string;
  scope: string[];
  body: string;
}

export interface Signal {
  id: string;
  screen: string; // route path
  metric: string;
  value: number | string;
  detail?: Record<string, unknown>;
  source: string; // "analytics.json" | "analytics.json#feedback[1]"
}

export interface EvidencePack {
  screen: string;
  screenFile: string;
  components: string[];
  apiCalls: string[];
  backendFiles: string[];
  signals: Signal[];
  knowledge: KnowledgeDoc[];
  protectedFiles: string[];
}
