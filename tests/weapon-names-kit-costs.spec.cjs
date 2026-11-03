const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
test("RGC-83 kit selector and weapon cards retain their correct names across language switches", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  for (const [language, machine, rifle] of [
    ["zh", "90mm机枪", "光束步枪"],
    ["en", "90mm Machine Gun", "Beam Rifle"],
    ["ja", "90mmマシンガン", "ビーム・ライフル"],
  ]) {
    const result = await page.evaluate(language => {
      I18n.setLanguage(language);
      const mg = UnitModels.RGC_83__kit_3, br = UnitModels.RGC_83__kit_2;
      const cards = [mg.weapons.find(w => w.id === "EF_GMRifle"), br.weapons.find(w => w.id === "EF_RMS_179_BR")]
        .map(w => WeaponInfo.card(w).querySelector(".weapon-name").textContent);
      return { kits: [mg.kitName, br.kitName], cards, costs: [mg.cost, br.cost] };
    }, language);
    expect(result.kits[0]).toContain(machine); expect(result.kits[1]).toContain(rifle);
    expect(result.cards).toEqual([machine, rifle]);
    expect(result.costs[1] - result.costs[0]).toBe(75);
  }
  expect(errors).toEqual([]);
});
