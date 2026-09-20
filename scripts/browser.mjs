import { chromium } from "playwright-core";

/** Use the same browser selection in local regressions and CI. */
export async function launchBrowser() {
  const requested = process.env.DRAFT_BROWSER;
  if (requested && !["chrome", "msedge", "chromium"].includes(requested)) {
    throw new Error("DRAFT_BROWSER must be chrome, msedge, or chromium");
  }
  const candidates = requested ? [requested] : ["chrome", "msedge", "chromium"];
  const errors = [];
  for (const candidate of candidates) {
    try {
      const browser = await chromium.launch({
        ...(candidate === "chromium" ? {} : { channel: candidate }),
        headless: true,
      });
      console.log(`Browser: ${candidate} ${browser.version()}`);
      return browser;
    } catch (error) {
      errors.push(`${candidate}: ${error.message}`);
    }
  }
  throw new Error(`No browser available. Run: node node_modules/playwright-core/cli.js install chromium\n${errors.join("\n")}`);
}
