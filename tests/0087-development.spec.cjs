const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
const tree = require("../shared/development-tree.json");
const url = pathToFileURL(path.resolve("public/client.html")).href;
async function ready(page) {
  await page.waitForFunction(() => typeof assetsReady !== "undefined" && assetsReady);
}
test("all three 0087 trees and unit details remain masked before complete 0079/0083 research", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await ready(page);
  await page.evaluate(() => document.getElementById("openDevelopment").click());
  for (const faction of ["AEUG", "TITANS", "NEO_ZEON"]) {
    await page.locator("#developmentFactionSelect").selectOption(faction);
    await expect(page.locator(".development-era-lock")).toHaveCount(2);
    await expect(page.locator("#developmentDetails .development-era-lock")).toHaveText(
      "请先完成任何0079科技树",
    );
    expect(
      await page
        .locator("#developmentMain")
        .evaluate((el) => el.classList.contains("development-era-locked")),
    ).toBe(true);
  }
  expect(errors).toEqual([]);
});
test("completed legacy tree opens free BASE, new faction starts empty, old saves round-trip and reload works", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    ({ ids }) =>
      localStorage.setItem(
        "projectgreed.developmentProgress.v1",
        JSON.stringify({ points: { EFSF: 0, ZEON: 0 }, claimed: {}, researched: { EFSF: ids } }),
      ),
    { ids: tree.EFSF.map((n) => n.id) },
  );
  await page.goto(url);
  await ready(page);
  await page.locator("#menuFactionSelect").selectOption("TITANS");
  expect(await page.evaluate(() => Formation.current().length)).toBe(0);
  const result = await page.evaluate(() => {
    const exported = ProfileSave.exportData();
    for (const f of ["AEUG", "TITANS", "NEO_ZEON"]) {
      delete exported.pilots[f];
      delete exported.formations[f];
      delete exported.development.points[f];
    }
    const old = ProfileSave.validate(exported);
    return {
      points: old.development.points.TITANS,
      pilots: old.pilots.TITANS.pilots.length,
      formation: old.formations.TITANS,
    };
  });
  expect(result).toEqual({ points: 0, pilots: 0, formation: null });
  await page.evaluate(() => document.getElementById("openDevelopment").click());
  await expect(page.locator("#developmentFactionSelect")).toHaveValue("TITANS");
  await expect(page.locator(".development-era-lock")).toHaveCount(0);
  await expect(page.locator('[data-tech-id="Tech_TITANS_0087_BaseTech"]')).toHaveAttribute(
    "data-state",
    "unlocked",
  );
  await page.screenshot({ path: "tmp/0087-tech-unlocked.png" });
  await page.reload();
  await ready(page);
  expect(await page.evaluate(() => PlayerProfile.faction())).toBe("TITANS");
  expect(errors).toEqual([]);
});
