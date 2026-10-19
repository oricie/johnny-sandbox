import { CHARTER } from "../charter";
import { imageBlocks } from "../llm";
import type { RouteInfo } from "./graph";
import { routeMap } from "./investigateCore";
import { codeTools, runAgent } from "./codeTools";

// The bridge from what people say to where it lives: a customer's words, a ticket, a Slack message or a
// screenshot in, the screen and the components that render what they describe out.

export interface Location {
  screens: string[];
  components: { file: string; role: string }[];
  ui_text: string[];
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["screens", "components", "ui_text", "confidence", "reasoning"],
  properties: {
    screens: { type: "array", items: { type: "string" }, description: "Routes from the map where the user meets this, most likely first" },
    components: {
      type: "array", description: "Files that render what the user describes, most specific first (the component itself before the page that holds it)",
      items: { type: "object", additionalProperties: false, required: ["file", "role"],
        properties: { file: { type: "string" }, role: { type: "string", description: "What this file renders in the user's terms" } } },
    },
    ui_text: { type: "array", items: { type: "string" }, description: "Interface text you matched, as users see it" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    reasoning: { type: "string", description: "How you got from their words to these files, briefly" },
  },
} as const;

export async function locate(root: string, routes: RouteInfo[], report: string,
  opts: { images?: string[]; maxSteps?: number; onStep?: (l: string) => void } = {}) {
  const code = codeTools(root, routes);
  const system = `${CHARTER}

---

Someone described something about the product in their own words: a customer, a teammate, a support
ticket. Find where it lives: the screens where users meet it and the components that render it.

- Start from what they'd see: the words on screen (find_ui_text), the screen they name, the action
  they took. Then confirm by reading the component.
- Users don't know component names and often name things loosely ("the drawer", "the popup", "settings").
- Prefer the specific component over the page that contains it, but list both if both matter.
- Shared components (a Button, a Dialog) count only if the problem is in the shared component itself.
- Be honest about confidence: high only if you read the code that renders what they describe.`;
  const { result, steps } = await runAgent<Location>({
    system, maxSteps: opts.maxSteps ?? 15, effort: "medium", onStep: opts.onStep, run: code.run, submit: "submit_location",
    tools: [...code.defs, { name: "submit_location", description: "Submit where it lives. Call once.", input_schema: SCHEMA, strict: true }],
    intro: [...imageBlocks(opts.images), { type: "text", text: `What they said:\n"${report}"\n\nRoute map (${routes.length} routes):\n${routeMap(routes)}` }],
  });
  return { ...result, steps, filesRead: Object.keys(Object.fromEntries(code.read)) };
}
