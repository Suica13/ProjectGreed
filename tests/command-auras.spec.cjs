const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path"),
  G = require("../shared/rules.js");
const neutral = (changes) => ({
  stats: {
    shooting: 100,
    melee: 100,
    defense: 100,
    speed: 100,
    accuracy: 100,
    reaction: 100,
    leadership: 100,
    awakening: 50,
    ...changes,
  },
});
for (const width of [1280, 390])
  test(`command passives display and browser estimates match shared server rules at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => I18n.setLanguage("zh"));
    await page.evaluate(() => Formation.previewUnit("MS_08TX"));
    await expect(page.locator("#formationDetailMechanics")).toContainText("攻击指挥");
    await expect(page.locator("#formationDetailMechanics")).toContainText("范围 3 格");
    const entry = { unitId: "Type61", kitId: "standard" };
    const game = G.create(false, 12, [[entry], [entry]], false, {
      costLimit: 99999,
      unitCostLimit: 99999,
      fogMode: "disabled",
    });
    game.tiles.forEach((row) => row.fill("plain"));
    const [a, b] = game.units;
    Object.assign(a, { x: 5, y: 5, pilot: neutral({ speed: 110, shooting: 110 }) });
    Object.assign(b, { x: 7, y: 5, pilot: neutral({ defense: 110 }) });
    for (const [index, id, team, x, y] of [
      [0, "MS_08TX", 0, 5, 8],
      [1, "MS_06S", 0, 6, 8],
      [2, "RX_79_G", 1, 7, 8],
    ]) {
      const model = Object.values(G.models).find((model) => model.prefabId === id);
      game.units.push({
        id: "provider-" + index,
        model: model.prefabId + "__" + model.kitId,
        team,
        ownerSeat: team,
        x,
        y,
        hp: model.hp,
        pilot: neutral({ leadership: 125 }),
      });
    }
    const weapon = G.modelOf(a).weapons[0];
    const expected = G.estimate(game, a, b, weapon);
    const actual = await page.evaluate(
      ({ state, weaponId }) => {
        const [a, b] = state.units;
        return {
          estimate: Rules.estimate(
            state,
            a,
            b,
            Rules.modelOf(a).weapons.find((weapon) => weapon.id === weaponId),
          ),
          move: Rules.modelOf(a).move,
          commandDescription: SkillControls.commandAbilities(Rules.modelOf(state.units[2]),state.units[2])[0].description,
          auras: Rules.commandEffects(state, a),
        };
      },
      { state: game, weaponId: weapon.id },
    );
    expect(actual.estimate).toEqual(JSON.parse(JSON.stringify(expected)));
    expect(actual.move).toBeCloseTo(G.models[a.model].move * 1.05, 8);
    expect(actual.commandDescription).toContain("范围 4 格");
    expect(actual.commandDescription).toContain("12%");
    expect(actual.auras.attack).toBeCloseTo(0.12, 8);
    expect(actual.auras.communication).toBeCloseTo(0.12, 8);
    expect(errors).toEqual([]);
  });
