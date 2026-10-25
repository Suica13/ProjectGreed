const { test, expect } = require("@playwright/test"),
  assert = require("node:assert/strict"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
test("offline deployment shows both human and AI roster groups, total COST and model identities", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.evaluate(() => I18n.setLanguage("zh"));
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await expect(page.locator("#roomPreparation")).toBeVisible();
  await page.locator("#startRoomGame").click();
  await expect(page.locator("#confirmFinalFormation")).toBeVisible();
  await page.locator("#confirmFinalFormation").click();
  await expect(page.locator("#gameScene")).toBeVisible();
  await page.locator("#showLog").click();
  await expect(page.locator("#log .deployment-roster")).toHaveCount(2);
  const expected = await page.evaluate(() =>
    Net.snapshot.members
      .filter((p) => p.seat !== null)
      .map((p) => {
        const units = game.units.filter((u) => Rules.ownerOf(u) === p.seat);
        return {
          name: p.name,
          count: units.length,
          cost: units.reduce((n, u) => n + Rules.modelOf(u).cost, 0),
        };
      }),
  );
  for (const p of expected) {
    await expect(page.locator("#log")).toContainText(
      "[" + p.name + "]部署编制：" + p.count + "台 · 总计COST " + p.cost,
    );
  }
  await expect(page.locator("#log")).toContainText("(RGM-79 吉姆)");
  assert.deepEqual(errors, []);
});
