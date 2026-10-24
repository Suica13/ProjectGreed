const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
const file = pathToFileURL(path.resolve("public/client.html")).href;

test("formation details show native structural strength, weapon mounting parts and twelve-round machine guns", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(file);
  await page.locator("#openFormation").click();
  await page.locator('[data-unit-id="MS_14A"]').click();
  await page.locator("#addFormationUnit").click();
  await page.locator(".formation-row").last().click();
  await expect(page.locator("#formationDetailStats")).toContainText("零件强度 125");
  await page.locator("#formationDetailKit").selectOption("machine_gun");
  const gun = page.locator(".formation-weapon-detail").first();
  await expect(gun).toContainText("发射次数 12");
  await expect(gun).toContainText("右臂");
  await expect(gun).toContainText("部位破坏系数 1");
  await page.evaluate(() => I18n.setLanguage("en"));
  await expect(page.locator("#formationDetailStats")).toContainText("Structural strength 125");
  await expect(gun).toContainText("Right arm");
  expect(errors).toEqual([]);
});

test("broken parts are visible and disable attack buttons while intact head weapons remain available", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(file);
  await expect.poll(() => page.evaluate(() => assetsReady)).toBe(true);
  await page.evaluate(() => {
    Net.leave();
    game = Rules.create(false, 1, [
      [{ unitId: "RGM_79", kitId: "beam_spray" }],
      [{ unitId: "RGM_79", kitId: "machine_gun" }],
    ]);
    const [a, b] = game.units;
    Object.assign(a, { x: 2, y: 4, brokenParts: { rightArm: true } });
    Object.assign(b, { x: 4, y: 4 });
    game.tiles[4][2] = game.tiles[4][4] = "plain";
    selected = a.id;
    phase = "idle";
    mode = "select";
    weaponId = null;
    moving = null;
    battleView = null;
    setPageView("game");
    update();
  });
  await expect(page.locator('#unitPartStatus [data-part="rightArm"]')).toContainText("损坏");
  await expect(page.locator('#unitPartStatus [data-part="head"]')).toContainText("完好");
  await expect(page.getByRole("button", { name: "攻击武器 光束喷枪", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "攻击武器 光束军刀", exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "攻击武器 头部火神炮", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".weapon.part-disabled").first()).toContainText("部位损坏，无法使用");
  expect(
    await page.evaluate(() => {
      const u = game.units[0];
      const layers = SpriteRenderer.visibleLayers(
        u.model,
        u.heldWeapon,
        true,
        false,
        null,
        0,
        false,
        u.brokenParts,
      );
      return {
        rightArm: layers.some((l) => l.bone === "RightArm"),
        head: layers.some((l) => l.bone === "Head"),
        weapon: layers.some((l) => l.name === "EF_BeamSprayGun"),
      };
    }),
  ).toEqual({ rightArm: false, head: true, weapon: false });
  await expect(page.locator("#unitPartStatus")).toContainText("四肢损毁：抗性降低 2.5%");
  await page.evaluate(() => {
    game.units[0].brokenParts.backpack = true;
    game.units[0].brokenParts.head = true;
    update();
  });
  await expect(
    page.getByRole("button", { name: "攻击武器 头部火神炮", exact: true }),
  ).toBeDisabled();
  await expect(page.locator("#unitPartStatus")).toContainText("头部损毁：攻击力-25%");
  await expect(page.locator("#unitPartStatus")).toContainText("背包损毁：移动力-25%");
  await expect(page.getByRole("button", { name: "技能 冲撞", exact: true })).toContainText("3,750");
  expect(errors).toEqual([]);
});

test("a broken paired-gun arm emits projectiles only from the surviving barrel", async ({
  page,
}) => {
  await page.goto(file);
  await expect.poll(() => page.evaluate(() => assetsReady)).toBe(true);
  const result = await page.evaluate(() => {
    const g = Rules.create(
      false,
      1,
      [[{ unitId: "MS_06K", kitId: "big_gun" }], [{ unitId: "RGM_79", kitId: "machine_gun" }]],
      false,
      { unitCostLimit: 1000 },
    );
    const [a, b] = g.units;
    Object.assign(a, { x: 2, y: 4, brokenParts: { rightArm: true } });
    Object.assign(b, { x: 4, y: 4, hp: 100000, shield: 0 });
    g.tiles[4][4] = "plain";
    const weapon = Rules.modelOf(a).weapons.find((w) => w.id === "ZN_MS_06K_BigGun");
    const event = Rules.fight(g, a, b, weapon, "defend", null, false)[0];
    const source = { unit: a, x: 100, y: 100, angle: 90, scale: 1 },
      target = { unit: b, x: 400, y: 100, angle: -90, scale: 1 };
    const plan = WeaponEffects.plan(weapon, source, target, event);
    return {
      shots: plan.shots.map((s) => s.index),
      strikes: event.strikes.filter((s) => s.executed).map((s) => s.shotIndex),
      contacts: plan.contacts.length,
      cues: plan.cues.filter((cue) => cue.sound === weapon.sound).length,
    };
  });
  expect(result.shots).toEqual([1, 3]);
  expect(result.strikes).toEqual([1, 3]);
  expect(result.contacts).toBe(2);
  expect(result.cues).toBe(2);
});

test("parts disappear at the recorded hit instead of when the final snapshot arrives", async ({
  page,
}) => {
  await page.goto(file);
  await expect.poll(() => page.evaluate(() => assetsReady)).toBe(true);
  const result = await page.evaluate(() => {
    Net.leave();
    game = Rules.create(false, 1, [
      [{ unitId: "RGM_79", kitId: "beam_spray" }],
      [{ unitId: "RGM_79", kitId: "machine_gun" }],
    ]);
    const [a, b] = game.units;
    Object.assign(a, { x: 2, y: 4 });
    Object.assign(b, { x: 4, y: 4, hp: 100000, shield: 0 });
    game.tiles[4][4] = "plain";
    const actors = structuredClone([a, b]);
    const events = Rules.fight(game, a, b, Rules.modelOf(a).weapons[0], "defend", null, false);
    const event = events[0];
    event.brokenParts = ["rightArm"];
    event.partsBefore = {};
    event.partsAfter = { rightArm: true };
    event.strikes[0].brokenParts = ["rightArm"];
    event.strikes[0].partsAfter = { rightArm: true };
    b.brokenParts = { rightArm: true };
    const battle = {
      id: "part-contact",
      a: a.id,
      b: b.id,
      actors,
      events,
      before: Object.fromEntries(actors.map((u) => [u.id, u.hp])),
    };
    MapCombat.reset();
    MapCombat.seed([battle]);
    battleView = { ...battle, networkId: "part-contact", battles: [battle] };
    phase = "playback";
    setPageView("game");
    MapCombat.begin(battleView, () => 0);
    const beforeGame = JSON.stringify(game),
      now = performance.now();
    MapCombat.update(now);
    const at = MapCombat.frames[0].plan.contacts[0].at;
    MapCombat.update(now + at * 1000 - 10);
    const before = !!MapCombat.units().find((u) => u.id === b.id).brokenParts.rightArm;
    MapCombat.update(now + at * 1000 + 10);
    const displayed = MapCombat.units().find((u) => u.id === b.id);
    const layers = SpriteRenderer.visibleLayers(
      displayed.model,
      displayed.heldWeapon,
      true,
      false,
      null,
      0,
      false,
      displayed.brokenParts,
    );
    const after = !!displayed.brokenParts.rightArm,
      hidden = !layers.some((l) => l.bone === "RightArm");
    const unchanged = JSON.stringify(game) === beforeGame;
    MapCombat.reset();
    battleView = null;
    return { before, after, hidden, unchanged };
  });
  expect(result).toEqual({ before: false, after: true, hidden: true, unchanged: true });
});
