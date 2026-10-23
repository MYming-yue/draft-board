import { chromium } from "playwright-core";
import assert from "node:assert/strict";

/** Fixture replacement explicitly accepts only the expected unsaved-open prompt. */
export async function prepareFixtureOpen(page) {
  const pending = await page.evaluate(() => {
    const state = window.__state;
    return state && (state.editingId || state.fileConflict || document.querySelector(".edge-label-input") || ["dirty", "saving", "error"].includes(state.saveState));
  });
  if (pending) page.once("dialog", async dialog => {
    assert.equal(dialog.type(), "confirm");
    assert.equal(dialog.message(), "当前白板有未保存内容，确定打开另一个文件吗？");
    await dialog.accept();
  });
}

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
