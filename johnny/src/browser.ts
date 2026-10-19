import fs from "node:fs";
import { chromium } from "playwright";

// Chromium for screenshots, sketches and walking a product. Some environments ship a bare binary at
// $PLAYWRIGHT_BROWSERS_PATH/chromium; Playwright's own Docker image keeps its usual layout there instead.
export function launchBrowser() {
  const bare = process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`;
  return chromium.launch(bare && fs.existsSync(bare) && fs.statSync(bare).isFile() ? { executablePath: bare } : {});
}
