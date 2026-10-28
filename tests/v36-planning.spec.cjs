const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
async function fixture(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(async () => {
    await SpriteRenderer.load();
    I18n.setLanguage("zh");
    Net.leave();
    TurnFlow.reset();
    session++;
    MapCombat.reset();
    AttackControls.reset();
    const entry = { unitId: "RGM_79", kitId: "machine_gun" };
    game = Rules.create(
      false,
      1,
      [
        [entry, entry],
        [entry, entry],
      ],
      false,
      { costLimit: 99999, unitCostLimit: 99999, fogMode: "disabled" },
    );
    game.tiles.forEach((row) => row.fill("plain"));
    const positions = [
      [2, 3],
      [2, 5],
      [4, 3],
      [3, 3],
    ];
    game.units.forEach((u, i) =>
      Object.assign(u, { x: positions[i][0], y: positions[i][1], hp: 100000, shield: 0 }),
    );
    selected = "0-0";
    weaponId = pending = battleView = moving = null;
    mode = "select";
    phase = "idle";
    setPageView("game");
    update();
    MapCamera.focus(3, 3);
    drawMap(performance.now());
  });
  return errors;
}
test("drafts retain targets and facing, accept direct map target changes, and submit once", async ({
  page,
}) => {
  const errors = await fixture(page);
  const weapon = await page.evaluate(() => {
    const u = getUnit(selected),
      w = Rules.modelOf(u).weapons.find((w) => Rules.actionCost(w) === 1);
    AttackControls.choose(u, getUnit("1-0"));
    return w.id;
  });
  await page.locator('[data-queue-weapon="' + weapon + '"]').click();
  const angle = await page.evaluate(() => PlanningUI.facing(getUnit(selected)));
  await page.getByRole("button", { name: "更换目标", exact: true }).click();
  await expect(page.locator("#cancelTargetSwitch")).toBeVisible();
  expect(await page.evaluate(() => PlanningUI.facing(getUnit(selected)))).toBe(angle);
  await page.locator("#cancelTargetSwitch").click();
  await page.evaluate(() => {
    const p = mapPosition(3, 3),
      r = byId("map").getBoundingClientRect();
    byId("map").onclick({ clientX: r.left + p.x, clientY: r.top + p.y });
  });
  expect(await page.evaluate(() => AttackControls.draft(getUnit(selected)).targetId)).toBe("1-1");
  await page.locator('[data-queue-weapon="' + weapon + '"]').click();
  await expect(page.locator(".hud-attack-queue .attack-plan-line")).toHaveCount(2);
  const arrows = await page.evaluate(() => {
    drawMap(performance.now());
    return byId("map").dataset.planCount;
  });
  expect(arrows).toBe("2");
  const result = await page.evaluate(() => {
    Net.request = (action, fields) => {
      window.sent = { action, ...fields };
      Net.active = false;
    };
    Net.active = true;
    byId("confirmAttackQueue").click();
    return { sent: window.sent, selected };
  });
  expect(result.sent.orders.map((o) => o.targetId)).toEqual(["1-0", "1-1"]);
  expect(result.selected).toBeNull();
  expect(errors).toEqual([]);
});
test("counter target switches append independent targets and expose numbered arrows", async ({
  page,
}) => {
  const errors = await fixture(page);
  const weapon = await page.evaluate(() => {
    const b = getUnit("1-0"),
      a = getUnit("0-0"),
      other = getUnit("0-1");
    Object.assign(other, { x: 3, y: 3 });
    getUnit("1-1").y = 6;
    const w = Rules.modelOf(b).weapons.find((w) => Rules.actionCost(w) === 1);
    phase = "reaction";
    response = "counter";
    counterId = null;
    counterTargetId = a.id;
    pending = {
      id: "counter-test",
      target: b.id,
      attacker: a.id,
      weapon: w.id,
      counterTargets: [a, other].map((u) => ({ attacker: u.id, weapon: w.id, options: [w.id] })),
    };
    counterDraftState = null;
    renderReaction();
    byId("reaction").hidden = false;
    update();
    return w.id;
  });
  await page.locator('[data-add-counter-weapon="' + weapon + '"]').click();
  await page.evaluate(() => selectCounterTarget("0-1"));
  await page.locator('[data-add-counter-weapon="' + weapon + '"]').click();
  const plans = await page.evaluate(() => {
    drawMap(performance.now());
    return {
      entries: counterDraft(getUnit(pending.target)).entries,
      arrows: byId("map").dataset.counterPlanCount,
    };
  });
  expect(plans.entries.map((e) => e.targetId)).toEqual(["0-0", "0-1"]);
  expect(plans.arrows).toBe("2");
  await expect(page.locator("#counterQueue .attack-plan-line")).toHaveCount(2);
  await page.locator("#changeCounterTarget").click();
  await expect(page.locator("#hudAttackPlanSummary")).toBeVisible();
  await page.locator("#cancelTargetSwitch").click();
  await expect(page.locator("#reaction")).toBeVisible();
  expect(errors).toEqual([]);
});
test("unit and hangar panels retain scroll and expanded weapon details on unrelated movement", async ({
  page,
}) => {
  const errors = await fixture(page);
  const result = await page.evaluate(() => {
    byId("hudUnitCommands").querySelector('[data-unit-command="info"]').click();
    byId("unitPanel").style.height = "180px";
    byId("unitPanel").style.overflowY = "auto";
    const detail = byId("unitPanel").querySelector("details");
    if (detail) detail.open = true;
    byId("unitPanel").scrollTop = 70;
    const before = byId("unitPanel").scrollTop;
    getUnit("0-1").x++;
    update();
    const unit = {
      before,
      after: byId("unitPanel").scrollTop,
      open: byId("unitPanel").querySelector("details")?.open,
    };
    const c = getUnit("0-0");
    c.model = Object.keys(UnitModels).find((id) => id.startsWith("PegasusClass__"));
    c.hp = Rules.modelOf(c).hp;
    c.en = Rules.modelOf(c).en;
    const u = getUnit("0-1");
    u.embarked = { carrierId: c.id, hangarId: Rules.hangars.of(c)[0].id };
    HangarUI.open(c);
    byId("hangarDialog").querySelector("[data-inspect-cargo]").click();
    const content = byId("hangarDialog").querySelector(".hangar-content");
    content.style.height = "180px";
    content.style.overflowY = "auto";
    content.scrollTop = 80;
    const hangarBefore = content.scrollTop;
    getUnit("1-0").y++;
    update();
    return {
      unit,
      hangar: {
        before: hangarBefore,
        after: byId("hangarDialog").querySelector(".hangar-content").scrollTop,
      },
    };
  });
  expect(result.unit.before).toBeGreaterThan(0);
  expect(result.unit.after).toBe(result.unit.before);
  expect(result.unit.open).toBe(true);
  expect(result.hangar.before).toBeGreaterThan(0);
  expect(result.hangar.after).toBe(result.hangar.before);
  expect(errors).toEqual([]);
});

test("radar markers use frozen playback intelligence instead of revealing final contacts", async ({
  page,
}) => {
  const errors = await fixture(page);
  const result = await page.evaluate(() => {
    const intel = Rules.sensors.view(game, 0);
    game.intel = { ...intel, radarContacts: [{ x: 10, y: 10 }] };
    Net.snapshot = { phase: "playback", combatIntel: { ...intel, radarContacts: [] } };
    const ctx = byId("map").getContext("2d"),
      original = ctx.strokeRect;
    let markers = 0;
    ctx.strokeRect = function (...args) {
      if (this.strokeStyle === "#ff4545") markers++;
      return original.apply(this, args);
    };
    drawMap(performance.now());
    const during = markers;
    Net.snapshot = null;
    markers = 0;
    drawMap(performance.now());
    const after = markers;
    ctx.strokeRect = original;
    return { during, after };
  });
  expect(result).toEqual({ during: 0, after: 1 });
  expect(errors).toEqual([]);
});
