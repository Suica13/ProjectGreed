const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.cjs",
  workers: 1,
  timeout: 30000,
  outputDir: ".openai/browser-results",
  use: {
    viewport: { width: 1600, height: 1000 },
    channel: process.env.SLG_BROWSER || (process.platform === "win32" ? "msedge" : "chromium"),
  },
});
