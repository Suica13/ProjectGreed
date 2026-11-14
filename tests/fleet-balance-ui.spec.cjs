const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
const P = require("../shared/pilots");
test("room shows fixed fleet limit and restores original free capacity", async ({page}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(()=>assetsReady);
  await page.evaluate(()=>{ I18n.setLanguage("zh"); LocalRoom.open(); });
  await expect(page.locator("#roomUnitLimit")).toHaveValue("3");
  await expect(page.locator("#roomUnitLimit")).toHaveAttribute("readonly", "");
  await expect(page.locator("#roomUnitLimit").locator("..")).toContainText("舰船数量上限");
  await page.evaluate(()=>Net.request("configure_room",{...Net.snapshot.settings,battleMode:"quick",formationStyle:"free",unitLimit:18}));
  await expect(page.locator("#roomUnitLimit")).toHaveValue("18");
  await expect(page.locator("#roomUnitLimit")).toBeEditable();
  await expect(page.locator("#roomUnitLimit").locator("..")).toContainText("单位容量点上限");
});
for (const width of [1440, 390])
  test(`reborn level eight can advance and duplicate result icons group at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 950 });
    const pilot = P.custom({
      ...P.createCustom("custom-reborn-eight", "Reborn"),
      level: 8,
      reincarnations: 1,
      experience: 200000,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript((pilot) => {
      localStorage.setItem("projectgreed.language", "zh");
      localStorage.setItem(
        "projectgreed.economy.v1",
        JSON.stringify({ money: 500000, supplies: 100000, inventory: {} }),
      );
      localStorage.setItem(
        "projectgreed.custom-pilots.v3.shared",
        JSON.stringify({ pilots: [pilot], awards: [] }),
      );
    }, pilot);
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    await page.locator("#shellHangar").click();
    await page.locator("#shellSubnav").getByRole("button", { name: "驾驶员", exact: true }).click();
    await page.getByRole("button", { name: "管理驾驶员 Reborn", exact: true }).click();
    await expect(page.locator("#upgradePilot")).toBeEnabled();
    await expect(page.locator("#upgradePilot")).toContainText("升职");
    const money = await page.evaluate(() => Economy.snapshot().money);
    await page.locator("#upgradePilot").click();
    await expect(page.locator("#customPilotProgress")).toContainText("Lv.9");
    expect(await page.evaluate(() => Economy.snapshot().money)).toBe(money - 40000);
    expect(await page.evaluate(() => Formation.exportPilotStores().PMC.pilots[0].level)).toBe(9);
    await page.locator("#finishCustomPilot").click();
    const icons = await page.evaluate(() => {
      Net.active = true;
      Net.seat = 0;
      Net.snapshot = {
        matchId: "grouped-result",
        economyAwards: [
          ...Array.from({ length: 5 }, (_, i) => ({
            id: "kill" + i,
            kind: "kill",
            model: i % 2 ? "MS_06F__bazooka" : "MS_06F__machine_gun",
          })),
          {
            kind: "result",
            lostUnits: [{ model: "Type61__standard" }, { model: "Type61__standard" }],
            losses: { Type61: 2 },
          },
        ],
        techAwards: [],
      };
      MatchResults.show();
      const sections = [...document.querySelectorAll("#victoryUnitIcons section")];
      return sections.map((section) => ({
        images: section.querySelectorAll("img").length,
        counts: [...section.querySelectorAll(".result-unit-count")].map((e) => e.textContent),
      }));
    });
    expect(icons).toEqual([
      { images: 1, counts: ["×2"] },
      { images: 1, counts: ["×5"] },
    ]);
    expect(errors).toEqual([]);
  });
