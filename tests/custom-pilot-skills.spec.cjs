const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const P = require("../shared/pilots.js");
for (const width of [1280, 390])
  test(`level-six pilot skill chooser persists and appears in combat at ${width}px`, async ({
    page,
  }) => {
    const pilots = [5, 6, 7].map((level) =>
      P.custom({ ...P.createCustom("custom-choice-" + level, "Skill" + level), level }),
    );
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript((pilots) => {
      if (localStorage.getItem("skill-choice-seeded")) return;
      localStorage.setItem("skill-choice-seeded", "yes");
      localStorage.setItem(
        "projectgreed.economy.v1",
        JSON.stringify({ money: 100000, supplies: 100000, inventory: {}, kits: {} }),
      );
      localStorage.setItem("projectgreed.language", "zh");
      localStorage.setItem("projectgreed.combatFaction", "PMC");
      localStorage.setItem(
        "projectgreed.custom-pilots.v3.shared",
        JSON.stringify({ pilots, awards: [] }),
      );
    }, pilots);
    async function open() {
      await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
      await page.waitForFunction(() => assetsReady);
      await page.locator("#shellHangar").click();
      await page
        .locator("#shellSubnav button")
        .filter({ hasText: /^驾驶员$/ })
        .click();
    }
    await open();
    await page.getByRole("button", { name: "管理驾驶员 Skill5", exact: true }).click();
    await expect(page.locator("#learnPilotSkill")).toBeDisabled();
    await page.locator("#finishCustomPilot").click();
    const alert = page.getByRole("button", { name: "选择驾驶员技能 Skill6", exact: true });
    await expect(alert).toHaveClass(/pilot-skill-alert/);
    await alert.click();
    await expect(page.locator("[data-pilot-skill-choice]")).toHaveCount(6);
    await expect(page.locator("#confirmPilotSkill")).toBeDisabled();
    const box = await page.locator("#pilotSkillPicker").boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.locator("#cancelPilotSkill").click();
    await page.locator("#learnPilotSkill").click();
    await page.locator('[data-pilot-skill-choice="Pilot_AtkUp_Trigger"]').click();
    await page.locator("#confirmPilotSkill").click();
    await expect(page.locator("#learnPilotSkill")).not.toHaveClass(/pilot-skill-alert/);
    await expect(page.locator("#learnPilotSkill")).toHaveText("查看驾驶员技能");
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("projectgreed.custom-pilots.v3.shared")).pilots.find(
        (p) => p.level === 6,
      ),
    );
    expect(saved.selectedSkillId).toBe("Pilot_AtkUp_Trigger");
    await page.locator("#resetPilotTraining").click();
    await page.locator("#gameDialog").getByRole("button", { name: "重置", exact: true }).click();
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("projectgreed.custom-pilots.v3.shared")).pilots.find(
            (p) => p.level === 6,
          ).selectedSkillId,
      ),
    ).toBeUndefined();
    expect(await page.evaluate(() => Economy.snapshot().money)).toBe(94000);
    await expect(page.locator("#learnPilotSkill")).toHaveClass(/pilot-skill-alert/);
    await page.locator("#learnPilotSkill").click();
    await page.locator('[data-pilot-skill-choice="Pilot_AccuracyUp_Trigger"]').click();
    await page.locator("#confirmPilotSkill").click();
    await open();
    await expect(
      page.getByRole("button", { name: "选择驾驶员技能 Skill6", exact: true }),
    ).toHaveCount(0);
    const result = await page.evaluate(async () => {
      const pilot = JSON.parse(
        localStorage.getItem("projectgreed.custom-pilots.v3.shared"),
      ).pilots.find((p) => p.level === 6);
      game = Rules.create(
        false,
        1,
        [
          [{ unitId: "RGM_79", kitId: "machine_gun", customPilot: pilot }],
          [{ unitId: "RGM_79", kitId: "machine_gun" }],
        ],
        false,
        { costLimit: 99999, unitCostLimit: 99999 },
      );
      game.tiles.forEach((r) => r.fill("plain"));
      const u = game.units[0];
      Object.assign(u, { x: 5, y: 8, en: 500 });
      Object.assign(game.units[1], { x: 12, y: 8 });
      phase = "idle";
      selected = u.id;
      setPageView("game");
      await SpriteRenderer.ensureAssets(SpriteRenderer.battleKeys(game));
      update();
      BattleHUD.setTab("skills");
      return pilot.selectedSkillId;
    });
    const skill = page.locator(`[data-pilot-skill="${result}"]`);
    await expect(skill).toBeVisible();
    await expect(skill).toBeEnabled();
    await skill.click();
    expect(await page.evaluate(() => game.units[0].en)).toBe(400);
    expect(await page.evaluate(() => PilotSystem.of(game.units[0]).stats.accuracy)).toBe(135);
    expect(errors).toEqual([]);
  });
