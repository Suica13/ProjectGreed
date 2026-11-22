const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
test("built client exposes new transport stats and friendly-only particle and smoke descriptions", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const data = await page.evaluate(() => {
    I18n.setLanguage("zh");
    Net.leave();
    const entry = (id) => ({ unitId: id, kitId: "standard" }),
      g = Rules.create(false, 99, [
        [entry("BigTrayClass")],
        [{ unitId: "RGM_79", kitId: "machine_gun" }],
      ]),
      ship = g.units[0],
      skill = Rules.unitSkills(ship).find((s) => s.type === "minovsky");
    Rules.useSkill(g, ship, skill.id, ship.x, ship.y);
    return {
      particle: SkillControls.description(skill),
      smoke: Object.values(UnitModels).find((m) => m.prefabId === "YMT_05").skills.find((s) => s.type === "smoke").description,
      own: Rules.minovskyAt(g, ship, ship.team),
      other: Rules.minovskyAt(g, ship, 1 - ship.team),
      units: ["Medea", "MedeaKai", "FatUncle", "FatUncleKai", "VTOLTransport", "VoLPHAU"].map(
        (id) => ({
          id,
          hp: UnitModels[id + "__standard"].hp,
          move: UnitModels[id + "__standard"].move,
        }),
      ),
    };
  });
  expect(data.particle).toContain("仅区域内友军");
  expect(data.particle).toContain("1.15");
  expect(data.smoke).toContain("降低10%");
  expect(data.own).toBe(true);
  expect(data.other).toBe(false);
  for (const unit of data.units) {
    expect(unit.hp).toBe(unit.id.includes("Kai") ? 35000 : 25000);
    expect(unit.move).toBe(unit.id.includes("Kai") || unit.id === "VoLPHAU" ? 8 : 7);
  }
  expect(errors).toEqual([]);
});
