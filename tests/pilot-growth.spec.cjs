const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path"),
  P = require("../shared/pilots.js");
for (const width of [1280, 390])
  test(`pilot editor shows level-based caps and enforces them at ${width}px`, async ({ page }) => {
    const pilots = [0, 2, 7, 10].map((level) =>
      P.custom({
        ...P.createCustom("custom-growth-" + level, "成长测试" + level),
        level,
        stats: { ...P.baseStats(), shooting: level === 2 ? 125 : P.statCap(level) },
      }),
    );
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript((pilots) => {
      localStorage.setItem("projectgreed.combatFaction", "PMC");
      localStorage.setItem("projectgreed.custom-pilots.v2.migrated", "PMC");
      localStorage.setItem(
        "projectgreed.custom-pilots.v2.PMC",
        JSON.stringify({ pilots, awards: [] }),
      );
    }, pilots);
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => I18n.setLanguage("zh"));
    await page.locator("#shellHangar").click();
    await page.locator("#shellSubnav button").filter({ hasText: /^驾驶员$/ }).click();
    for (const level of [0, 2, 7, 10]) {
      await page.getByRole("button", { name: "管理驾驶员 成长测试" + level, exact: true }).click();
      await expect(page.locator("#customPilotStats")).toContainText(
        "射击 " + (level === 2 ? 125 : P.statCap(level)) + " / " + P.statCap(level),
      );
      const plus = page.getByRole("button", { name: "强化射击", exact: true });
      if (level === 2) {
        await expect(plus).toBeEnabled();
        await plus.click();
        await page.locator("#confirmPilotTraining").click();
        expect(
          await page.evaluate(
            () =>
              JSON.parse(localStorage.getItem("projectgreed.custom-pilots.v3.shared")).pilots.find(
                (p) => p.level === 2,
              ).stats.shooting,
          ),
        ).toBe(126);
      } else await expect(plus).toBeDisabled();
      if (level === 10) await expect(page.locator("#customPilotProgress")).toContainText("MAX");
      await page.locator("#finishCustomPilot").click();
    }
  });

for (const width of [1280, 390])
  test(`shared pilot migration, +5, paid reset and title alignment at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const pilots = ["EFSF", "ZEON"].map((f) => P.createCustom("custom-shared-" + f, f, null, f));
    await page.addInitScript((pilots) => {
      if (localStorage.getItem("shared-test-seeded")) return;
      localStorage.setItem("shared-test-seeded", "yes");
      localStorage.setItem("projectgreed.custom-pilots.v2.migrated", "yes");
      for (const p of pilots)
        localStorage.setItem(
          "projectgreed.custom-pilots.v2." + p.faction,
          JSON.stringify({ pilots: [p], awards: [] }),
        );
    }, pilots);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => I18n.setLanguage("zh"));
    await page.locator("#shellHangar").click();
    await page.locator("#shellSubnav button").filter({ hasText: /^驾驶员$/ }).click();
    for (const faction of ["PMC", "ZEON", "EFSF"]) {
      await page.evaluate((f) => Formation.setGroup(f), faction);
      await expect(page.locator("#customPilotList .custom-pilot-card")).toHaveCount(2);
    }
    await page.getByRole("button", { name: "管理驾驶员 ZEON", exact: true }).click();
    const aligned = await page.evaluate(() => {
      const title = byId("pilotTrainingTitle").getBoundingClientRect(),
        button = byId("resetPilotTraining").getBoundingClientRect(),
        header = byId("resetPilotTraining").parentElement.getBoundingClientRect();
      return (
        Math.abs(button.right - header.right) < 2 &&
        Math.abs(button.y + button.height / 2 - title.y - title.height / 2) < 2
      );
    });
    expect(aligned).toBe(true);
    await expect(page.locator("#customPilotProgress")).toContainText("Lv.0");
    await expect(page.locator("#customPilotProgress")).toContainText("强化点 80");
    await page.locator("#openPilotAttributeHelp").click();
    await expect(page.locator("#pilotAttributeHelp")).toContainText("0.25个百分点");
    await expect(page.locator("#pilotAttributeHelp")).toContainText("107.5%");
    await expect(page.locator("#pilotAttributeHelp")).toContainText("范围增加1格、效果增加1个百分点");
    await page.locator("#pilotAttributeHelp").getByRole("button", {name:"关闭",exact:true}).click();

    await page.getByRole("button", { name: "强化射击 +5", exact: true }).click();
    await page.locator("#confirmPilotTraining").click();
    await expect(page.locator("#customPilotStats")).toContainText("射击 105 / 125");
    await page.locator("#resetPilotTraining").click();
    await page.locator("#gameDialog").getByRole("button", { name: "重置", exact: true }).click();
    await expect(page.locator("#customPilotStats")).toContainText("射击 100 / 125");
    expect(await page.evaluate(() => Economy.snapshot().money)).toBe(5000);
    const saved = await page.evaluate(() => ProfileSave.exportData());
    expect(saved.pilots.ZEON.pilots[0].points).toBe(80);
    await page.evaluate((save) => ProfileSave.importData(save), saved);
    await page.reload();
    await page.waitForFunction(() => assetsReady);
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("projectgreed.custom-pilots.v3.shared")).pilots.length,
      ),
    ).toBe(2);
    expect(errors).toEqual([]);
  });
