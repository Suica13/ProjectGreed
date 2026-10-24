const { test, expect } = require("@playwright/test");
const { openPresentationFixture } = require("./presentation-fixture.cjs");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
async function open(page) {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await openPresentationFixture(page, false);
  await page.locator("#confirmDeployment").click();
  await page.locator("#confirmDeployment").click();
}
test("response sidebars identify both owners and leave the defender visible without changing zoom", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  await page.evaluate(() => {
    const a = game.units[0],
      b = game.units.find((u) => u.team === 1);
    Object.assign(a, { x: 10, y: 8 });
    Object.assign(b, { x: 12, y: 8 });
    MapCamera.setZoom(2.5);
    beginAttack(
      a,
      b,
      UnitModels[a.model].weapons.find((w) => w.type !== "melee"),
    );
  });
  await expect(page.locator("#reaction")).toBeVisible();
  await expect(page.locator("#engagement")).toContainText("本机玩家1 · 队伍1");
  await expect(page.locator("#defenderInfo")).toContainText("本机玩家2 · 队伍2");
  expect(await page.evaluate(() => MapCamera.zoom)).toBe(2.5);
  const layout = await page.evaluate(() => {
    const a = document.querySelector(".response-attacker").getBoundingClientRect();
    const b = document.querySelector(".response-defender").getBoundingClientRect();
    const unit = getUnit(pending.target),
      pos = mapPosition(unit.x, unit.y),
      map = byId("map").getBoundingClientRect();
    const x = map.x + pos.x,
      y = map.y + pos.y;
    return {
      a: a.right,
      b: b.left,
      x,
      y,
      visible: document.elementFromPoint(x, y) === byId("map"),
    };
  });
  expect(layout.x).toBeGreaterThan(layout.a);
  expect(layout.x).toBeLessThan(layout.b);
  expect(layout.visible).toBe(true);
  await page.locator("#responseEvade").click();
  await expect(page.locator("#estimate")).toContainText("本次不进行反击");
  await page.locator("#responseCounter").click();
  await expect(page.locator("#counterList .weapon")).not.toHaveCount(0);
  await page.screenshot({ path: ".openai/response-sidebars-desktop.png" });
  await page.setViewportSize({ width: 430, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator("#confirmResponse")).toBeInViewport();
  await expect(page.locator("#responseCounter")).toBeInViewport();
  await page.screenshot({ path: ".openai/response-sidebars-mobile.png" });
  expect(errors).toEqual([]);
});
test("map bullets originate from the rendered gun after either dodge lane at every facing", async ({
  page,
}) => {
  await open(page);
  const errors = await page.evaluate(() => {
    const failures = [];
    const a = game.units[0],
      b = game.units.find((u) => u.team === 1);
    const weapon = UnitModels[a.model].weapons.find((w) => w.type !== "melee");
    for (const [dx, dy] of [
      [2, 0],
      [-2, 0],
      [0, 2],
      [0, -2],
    ])
      for (const slot of [-1, 0, 1]) {
        MapCombat.reset();
        Object.assign(a, { x: 11, y: 8 });
        Object.assign(b, { x: 11 + dx, y: 8 + dy });
        const event = {
          from: a.id,
          to: b.id,
          weapon: weapon.id,
          heldWeapon: weapon.id,
          type: weapon.type,
          before: b.hp,
          after: b.hp,
          damage: 0,
          hit: false,
          sourceDodgeSlot: slot,
        };
        const actors = JSON.parse(JSON.stringify([a, b]));
        const record = {
          id: "origin",
          a: a.id,
          b: b.id,
          actors,
          events: [event],
          before: { [a.id]: a.hp, [b.id]: b.hp },
        };
        MapCombat.seed([record]);
        battleView = {
          ...record,
          networkId: record.id,
          index: 0,
          start: performance.now(),
          displayHp: record.before,
        };
        phase = "battle";
        MapCombat.begin(battleView, () => 0);
        MapCombat.update(performance.now());
        const f = MapCombat.frame;
        const original = SpriteRenderer.draw;
        for (const shot of f.plan.shots) {
          f.time = shot.at;
          f.lastNow = performance.now();
          let draw;
          SpriteRenderer.draw = function (...args) {
            if (args[1] === a.model && !draw) draw = args;
            return original(...args);
          };
          drawMap(performance.now());
          SpriteRenderer.draw = original;
          const [, model, x, y, scale, angle, clip, time] = draw;
          const muzzle = SpriteRenderer.muzzle(
            model,
            weapon,
            { x, y, scale, angle },
            clip,
            time,
            shot.index,
          );
          const expected = {
            x: mapGeo.ox + (shot.origin.x * mapGeo.tile) / 64,
            y: mapGeo.oy + (shot.origin.y * mapGeo.tile) / 64,
          };
          if (Math.hypot(muzzle.x - expected.x, muzzle.y - expected.y) > 0.001)
            failures.push({ slot, dx, dy, index: shot.index, muzzle, expected });
        }
      }
    return failures;
  });
  expect(errors).toEqual([]);
});

test("all incoming attackers remain visible in an independently scrollable list", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    const entry = { unitId: "RGM_79", kitId: "beam_spray" };
    game = Rules.create(false, 1, [Array.from({ length: 9 }, () => entry), [entry]], false, {
      costLimit: 5000,
    });
    const attackers = game.units.filter((u) => u.team === 0),
      defender = game.units.find((u) => u.team === 1);
    Object.assign(defender, { x: 12, y: 9 });
    attackers.forEach((u, i) => Object.assign(u, { x: 8 + (i % 3), y: 8 + Math.floor(i / 3) }));
    phase = "idle";
    beginAttack(attackers[0], defender, getWeapon(attackers[0], "EF_BeamSprayGun"));
    pending.attacks = attackers.map((u) => ({
      attacker: u.id,
      target: defender.id,
      weapon: "EF_BeamSprayGun",
    }));
    pending.counterTargets = pending.attacks.map((intent) => ({
      ...intent,
      options: Rules.modelOf(defender)
        .weapons.filter((w) => Rules.canCounter(game, defender, getUnit(intent.attacker), w))
        .map((w) => w.id),
    }));
    renderReaction();
  });
  await expect(page.locator("#engagement .incoming-entry")).toHaveCount(9);
  expect(await page.locator("#engagement").evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(
    true,
  );
  await page.locator("#responseDefend").click();
  await expect(page.locator("#engagement .incoming-entry")).toHaveCount(9);
  await page.locator("#engagement .incoming-entry").last().scrollIntoViewIfNeeded();
  expect(await page.locator("#engagement").evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
  await page.screenshot({ path: ".openai/incoming-units-scroll.png" });
});
