import type { RouteInfo } from "./graph";

// In a large app most of a page's reachable code is server, data and API plumbing, and BFS order
// reaches it before the view. For a UX review, rendered code comes first: components before
// server code, nearest to the page first within each group.
export const SERVER = /(^|\/)(server|trpc|prisma|repositor(y|ies)|migrations|api)\/|\.(repository|service|handler|schema)\.ts$|Repository\.ts$|Service\.ts$/i;

export const uiFirst = (files: string[]) => [
  ...files.filter((f) => f.endsWith(".tsx") && !SERVER.test(f)),
  ...files.filter((f) => !f.endsWith(".tsx") && !SERVER.test(f)),
  ...files.filter((f) => SERVER.test(f)),
];

export const viewFiles = (r: RouteInfo) => uiFirst(r.files).filter((f) => f !== r.page && f.endsWith(".tsx")).slice(0, 8);
