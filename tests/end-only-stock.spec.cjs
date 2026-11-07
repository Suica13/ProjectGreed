const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;

test("battle stock is preserved across reload and actual losses settle only once", async ({ page }) => {
  await page.goto(url);
  await page.waitForFunction(() => assetsReady);
  const before = await page.evaluate(() => {
    const before = Economy.exportProgress();
    ProductionUI.receiveAwards({ phase: "deployment", economyAwards: [{
      id: "stock-launch", matchId: "stock-match", kind: "deployment", money: 0, supplies: 0,
      stockUsed: { inventory: {}, kits: {} },
    }] });
    return before;
  });
  await page.reload();
  await page.waitForFunction(() => assetsReady);
  expect(await page.evaluate(() => Economy.quantity("Type61"))).toBe(before.inventory.Type61);
  expect(await page.evaluate(() => Economy.kitQuantity("Type61__standard"))).toBe(before.kits.Type61__standard);
  await page.evaluate(() => {
    const result = { phase: "finished", economyAwards: [{
      id: "stock-result", matchId: "stock-match", kind: "result", money: 123, supplies: 456,
      stockLost: { inventory: { Type61: 1 }, kits: { Type61__standard: 1 } },
    }] };
    ProductionUI.receiveAwards(result);
    ProductionUI.receiveAwards(result);
  });
  await page.reload();
  await page.waitForFunction(() => assetsReady);
  const after = await page.evaluate(() => {
    ProductionUI.receiveAwards({ phase: "finished", economyAwards: [{
      id: "stock-result", matchId: "stock-match", kind: "result", money: 123, supplies: 456,
      stockLost: { inventory: { Type61: 1 }, kits: { Type61__standard: 1 } },
    }] });
    return Economy.exportProgress();
  });
  expect(after.inventory.Type61).toBe(before.inventory.Type61 - 1);
  expect(after.kits.Type61__standard).toBe(before.kits.Type61__standard - 1);
  expect(after.money).toBe(before.money + 123);
  expect(after.supplies).toBe(before.supplies + 456);
});
