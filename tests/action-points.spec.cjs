const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
async function setup(page) {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await page.evaluate(() => {
    Net.leave();
    game = Rules.create(
      false,
      1,
      [[{ unitId: "RX_78NT_1", kitId: "kit_1" }], [{ unitId: "RGM_79", kitId: "machine_gun" }]],
      false,
      { costLimit: 99999, unitCostLimit: 10000 },
    );
    game.tiles.forEach((r) => r.fill("plain"));
    Object.assign(game.units[0], { x: 10, y: 10 });
    Object.assign(game.units[1], { x: 12, y: 10, hp: 1000000, shield: 0 });
    phase = "idle";
    mode = "select";
    selected = null;
    AttackControls.reset();
    setPageView("game");
    select(game.units[0].id);
    MapCamera.setZoom(3);
    MapCamera.focus(11, 10, { preserveZoom: true });
  });
}
test("target-first editor permits repeating a weapon, enforces AP and preserves selected order", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await setup(page);
  await expect(page.locator("[data-queue-weapon]")).toHaveCount(0);
  await page.evaluate(() => {
    document.querySelector('[data-unit-command="attack"]').click();
    AttackControls.choose(game.units[0], game.units[1]);
  });
  const rifle = page.locator('[data-queue-weapon="EF_RX_78NT_1_BR"]');
  await rifle.click();
  await rifle.click();
  await expect(rifle).toBeDisabled();
  await page.locator('[data-queue-weapon="Common_DoubleVulcan_MS"]').click();
  await expect(page.locator("#attackQueueBudget")).toContainText("0/5");
  await expect(page.locator("#attackQueueBudget")).toContainText("EN 100/950");
  await expect(page.locator("[data-remove-queue-weapon]")).toHaveCount(3);
  const draft = await page.evaluate(() => AttackControls.draft(game.units[0]).weapons);
  expect(draft).toEqual(["EF_RX_78NT_1_BR", "EF_RX_78NT_1_BR", "Common_DoubleVulcan_MS"]);
  await page.screenshot({ path: ".openai/action-points-queue.png" });
  await page.evaluate(() => {
    beginAttack = (a, b, w, weapons) => {
      window.queuedRequest = { target: b.id, weapons: weapons.map((w) => w.id) };
    };
  });
  await page.locator("#confirmAttackQueue").click();
  expect(await page.evaluate(() => window.queuedRequest)).toEqual({
    target: "1-0",
    weapons: draft,
  });
  expect(errors).toEqual([]);
});
test("map presentation runs one unit weapons sequentially rather than starting them in parallel", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await setup(page);
  const result = await page.evaluate(() => {
    const [a, b] = game.units;
    let id = 0;
    const planner = createAttackPlanner(Rules, () => String(++id)),
      room = { game, matchId: "queue" };
    planner.reset(room);
    const w = Rules.modelOf(a).weapons.find((w) => w.id === "EF_RX_78NT_1_BR");
    planner.plan(room, a, b, [w, w], 0);
    const [request] = planner.prepare(room);
    planner.choose(room, request.id, "defend");
    const battles = planner.resolve(room);
    MapCombat.reset();
    MapCombat.seed(battles);
    battleView = { mapBattle: true, battles, completed: false, start: performance.now() };
    phase = "battle";
    MapCombat.begin(battleView, () => 0);
    MapCombat.update(performance.now());
    const first = MapCombat.frames.map((f) => f.view.attackQueue.index);
    const f = MapCombat.frames[0];
    f.time = f.plan.duration + 0.1;
    f.lastNow = performance.now();
    MapCombat.update(performance.now());
    const second = MapCombat.frames.map((f) => f.view.attackQueue.index);
    return { first, second };
  });
  expect(result.first).toEqual([0]);
  expect(result.second).toEqual([1]);
  expect(errors).toEqual([]);
});
