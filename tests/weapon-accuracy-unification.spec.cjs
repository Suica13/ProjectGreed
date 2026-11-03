const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

test("built client uses fixed weapon accuracy and shows the ship cannon trait", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(() => {
    const models = Object.values(Rules.models);
    const bazooka = models.filter(m => !m.ship).flatMap(m => m.weapons)
      .find(w => WeaponClasses.classify(w) === "bazooka");
    const cannon = models.filter(m => m.ship).flatMap(m => m.weapons)
      .find(w => WeaponClasses.classify(w) === "beam_cannon");
    const card = WeaponInfo.card(cannon);
    document.body.append(card);
    const text = card.textContent;
    card.remove();
    return { bazooka: bazooka.hit, cannon: cannon.hit, text };
  });
  expect(result.bazooka).toBe(75);
  expect(result.cannon).toBe(60);
  expect(result.text).toContain("舰炮");
  expect(result.text).toContain("命85%");
  expect(errors).toEqual([]);
});
