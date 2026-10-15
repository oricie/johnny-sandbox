import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Johnny's identity and rules. Every model call starts with it, so he behaves the same
// whether he is reviewing, building, answering or chatting.
export const CHARTER = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "CHARTER.md"), "utf8");
