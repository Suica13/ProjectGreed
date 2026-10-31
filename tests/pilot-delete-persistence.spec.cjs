const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
async function open(page) {
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await page.waitForFunction(() => assetsReady);
}
test("deleting a pilot clears all saved assignments and survives reload", async ({ page }) => {
  const P = require("../shared/pilots.js");
  const pilot = P.createCustom("custom-delete-test", "待删除驾驶员", null, "EFSF");
  const units = [{ unitId: "Type61", kitId: "standard", customPilot: pilot }];
  await page.addInitScript(
    ({ pilot, units }) => {
      if (localStorage.getItem("pilot-delete-fixture")) return;
      localStorage.setItem("projectgreed.combatFaction", "EFSF");
      localStorage.setItem(
        "projectgreed.custom-pilots.v2.EFSF",
        JSON.stringify({ pilots: [pilot], awards: [] }),
      );
      localStorage.setItem("projectgreed.custom-pilots.v2.migrated", "EFSF");
      localStorage.setItem(
        "slg-formations-v1.EFSF",
        JSON.stringify({
          version: 3,
          squads: [
            { name: "编组一", units },
            { name: "编组二", units },
          ],
        }),
      );
      localStorage.setItem("pilot-delete-fixture", "1");
    },
    { pilot, units },
  );
  await open(page, false);
  await page.locator("#openFormation").click();
  await page.locator("#formationPilotsTab").click();
  const remove = page.getByRole("button", { name: "删除驾驶员 待删除驾驶员", exact: true });
  await remove.click();
  await page.locator("#gameDialog").getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.locator(".custom-pilot-card")).toHaveCount(1);
  await remove.click();
  await page.locator("#gameDialog").getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.locator(".custom-pilot-card")).toHaveCount(0);
  const stored = await page.evaluate(() => ({
    pilots: JSON.parse(localStorage.getItem("projectgreed.custom-pilots.v2.EFSF")).pilots,
    squads: JSON.parse(localStorage.getItem("slg-formations-v1.EFSF")).squads,
    current: Formation.current(),
  }));
  expect(stored.pilots).toEqual([]);
  for (const squad of stored.squads) expect(squad.units[0].customPilot).toBeUndefined();
  expect(stored.current[0].customPilot).toBeUndefined();
  await page.reload();
  await page.waitForFunction(() => assetsReady);
  await page.locator("#openFormation").click();
  await page.locator("#formationPilotsTab").click();
  await expect(page.locator(".custom-pilot-card")).toHaveCount(0);
});
