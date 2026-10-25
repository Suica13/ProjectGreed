const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
async function setup(page, id) {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await page.evaluate((id) => {
    Net.leave();
    const kitId = Object.values(UnitModels).find((m) => m.prefabId === id).kitId;
    game = Rules.create(
      false,
      1,
      [[{ unitId: id, kitId }], [{ unitId: "RGM_79", kitId: "machine_gun" }]],
      false,
      { costLimit: 99999, unitCostLimit: 10000 },
    );
    game.tiles.forEach((r) => r.fill("plain"));
    Object.assign(game.units[0], { x: 10, y: 10 });
    Object.assign(game.units[1], { x: 15, y: 10 });
    selected = game.units[0].id;
    phase = "idle";
    mode = "select";
    setPageView("game");
    update();
    MapCamera.setZoom(3);
    MapCamera.focus(10, 10, { preserveZoom: true });
  }, id);
}
for (const [id, target] of [
  ["RX_78NT_1_FA", "RX_78NT_1"],
  ["FA_78_1", "FA_78_1_NA"],
  ["YMT_05", "YMT_05_ModeB"],
])
  test(id + " button converts in place and renders native target art", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await setup(page, id);
    const skill = id === "YMT_05" ? "Transform" : "ExitUnit";
    await page.locator(`[data-unit-skill="${skill}"]`).click();
    await expect
      .poll(() => page.evaluate(() => Rules.modelOf(game.units[0]).prefabId))
      .toBe(target);
    const result = await page.evaluate(() => {
      drawMap(performance.now());
      const u = game.units[0];
      return {
        acted: u.acted,
        selected: selected === u.id,
        count: game.units.length,
        position: [u.x, u.y],
        images: SpriteRenderer.models[u.model].decals.every(
          (l) => !!SpriteRenderer.images[l.asset],
        ),
      };
    });
    expect(result).toEqual({
      acted: true,
      selected: true,
      count: 2,
      position: [10, 10],
      images: true,
    });
    expect(errors).toEqual([]);
  });
test("Magella ejection highlights adjacent cells and selects the newly separated aircraft", async ({
  page,
}) => {
  await setup(page, "MTank");
  await page.locator('[data-unit-skill="ExitUnit"]').click();
  const cell = await page.evaluate(() => {
    drawMap(performance.now());
    const u = getUnit(selected),
      targets = Rules.skillTargets(game, u, "ExitUnit"),
      c = targets.find((c) => c.x === 11 && c.y === 10),
      p = mapPosition(c.x, c.y),
      b = byId("map").getBoundingClientRect();
    return { x: b.left + p.x, y: b.top + p.y, range: targets.map((c) => Rules.dist(u, c)) };
  });
  expect(cell.range).toEqual([1, 1, 1, 1]);
  await page.mouse.click(cell.x, cell.y);
  await expect
    .poll(() => page.evaluate(() => Rules.modelOf(getUnit(selected)).prefabId))
    .toBe("MTank_Top");
  expect(
    await page.evaluate(() =>
      game.units.filter((u) => u.team === 0).map((u) => [Rules.modelOf(u).prefabId, u.x, u.y]),
    ),
  ).toEqual([
    ["MTank_Chassis", 10, 10],
    ["MTank_Top", 11, 10],
  ]);
});

test("EXAM returns to base art exactly when head destruction is presented", async ({ page }) => {
  await setup(page, "RX_79_BD_1");
  const result = await page.evaluate(() => {
    const u = game.units[0],
      enemy = game.units[1],
      base = u.model,
      skill = Rules.unitSkills(u).find((s) => s.type === "overdrive");
    Rules.useSkill(game, u, skill.id, u.x, u.y);
    u.shield = 0;
    const form = u.model;
    Object.assign(enemy, { x: 12, y: 10, acted: false });
    game.team = 1;
    const actors = structuredClone([enemy, u]),
      original = UnitParts.applyHit;
    UnitParts.applyHit = (game, target) => {
      if (target.brokenParts?.head) return null;
      target.brokenParts = { ...target.brokenParts, head: true };
      return "head";
    };
    let events;
    try {
      events = Rules.fight(
        game,
        enemy,
        u,
        { ...Rules.modelOf(enemy).weapons[0], hit: 10000, damageComponents: { shell: 1000 } },
        "defend",
      );
    } finally {
      UnitParts.applyHit = original;
    }
    const record = {
      id: "head-exam",
      a: enemy.id,
      b: u.id,
      actors,
      events,
      before: Object.fromEntries(actors.map((u) => [u.id, u.hp])),
    };
    MapCombat.reset();
    MapCombat.seed([record]);
    battleView = { ...record, index: 0, networkId: record.id, displayHp: { ...record.before } };
    phase = "battle";
    MapCombat.begin(battleView, () => 0);
    MapCombat.update(performance.now());
    const frame = MapCombat.frame,
      impact =
        frame.plan.contacts.find((c) => c.brokenParts?.includes("head"))?.at ??
        frame.plan.impacts[0];
    const samples = [];
    for (const time of [impact - 0.01, impact + 0.01]) {
      frame.time = time;
      frame.lastNow = performance.now();
      drawMap(performance.now());
      const shown = MapCombat.units().find((x) => x.id === u.id);
      samples.push({
        model: shown.model,
        red: SpriteRenderer.visibleLayers(shown.model, null).some((l) =>
          l.name.startsWith("System_Red_"),
        ),
      });
    }
    return { base, form, samples };
  });
  expect(result.samples).toEqual([
    { model: result.form, red: true },
    { model: result.base, red: false },
  ]);
});
