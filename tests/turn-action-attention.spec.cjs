const { test } = require("@playwright/test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;

test("exhausted human units pulse a wider end button and wait for a manual click", async ({
  page,
}) => {
  await page.goto(url);
  await page.evaluate(async () => {
    await SpriteRenderer.load();
    I18n.setLanguage("zh");
    Net.leave();
    TurnFlow.reset();
    session++;
    const entry = { unitId: "RGM_79", kitId: "machine_gun" };
    game = Rules.create(false, 1, [[entry], [entry]], false, {
      costLimit: 3000,
      unitCostLimit: 1000,
    });
    phase = "idle";
    setPageView("game");
    update();
  });
  assert.equal(
    await page.evaluate(() => byId("endTurn").classList.contains("action-attention")),
    false,
  );
  const state = await page.evaluate(async () => {
    game.units.filter((u) => u.team === 0).forEach((u) => Rules.wait(game, u));
    update();
    const pulse = byId("endTurn").classList.contains("action-attention"),
      style = getComputedStyle(byId("endTurn"));
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return {
      pulse,
      animation: style.animationName,
      width: byId("endTurn").getBoundingClientRect().width,
      team: game.team,
    };
  });
  assert.ok(state.pulse);
  assert.equal(state.animation, "turn-action-pulse");
  assert.ok(state.width >= 200);
  assert.equal(state.team, 0);
  await page.locator("#endTurn").click();
  assert.equal(await page.evaluate(() => game.team), 1);
  assert.equal(await page.evaluate(() => byId("endActionConfirm").open), false);
});

test("deployment pulses green, while end attention only depends on the local player units", async ({
  page,
}) => {
  await page.goto(url);
  await page.evaluate(async () => {
    await SpriteRenderer.load();
    I18n.setLanguage("zh");
    LocalRoom.open();
    await new Promise((r) => setTimeout(r, 0));
    Net.request("start_game", { formation: Formation.current() });
    await new Promise((r) => setTimeout(r, 0));
    byId("confirmFinalFormation").click();
    await new Promise((r) => setTimeout(r, 0));
  });
  const deployment = await page.evaluate(() => ({
    animation: getComputedStyle(byId("confirmDeployment")).animationName,
    width: byId("confirmDeployment").getBoundingClientRect().width,
  }));
  assert.equal(deployment.animation, "turn-action-pulse");
  assert.ok(deployment.width >= 200);
  await page.evaluate(async () => {
    byId("confirmDeployment").click();
    await new Promise((r) => setTimeout(r, 0));
  });
  const state = await page.evaluate(() => {
    const own = game.units.filter((u) => Net.owns(u));
    game.units.push({
      ...own[0],
      id: "ally-example",
      ownerSeat: 2,
      x: own[0].x + 2,
      acted: false,
      moved: false,
    });
    own.forEach((u) => (u.acted = true));
    update();
    const result = {
      teamHasActions: Rules.hasActions(game),
      ownHasActions: Rules.hasActions(game, Net.seat),
      pulse: byId("endTurn").classList.contains("action-attention"),
    };
    own[0].acted = false;
    own[0].moved = false;
    update();
    result.restoredPulse = byId("endTurn").classList.contains("action-attention");
    return result;
  });
  assert.deepEqual(state, {
    teamHasActions: true,
    ownHasActions: false,
    pulse: true,
    restoredPulse: false,
  });
});
