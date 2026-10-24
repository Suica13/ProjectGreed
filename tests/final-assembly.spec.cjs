const { waitForRoomSettings } = require("./room-settings-fixture.cjs");
const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
test("offline AI profiles and OVERCOST final assembly edit, ally preview and deployment", async ({
  page,
}) => {
  test.setTimeout(45000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.locator("#openFormation").click();
  while (await page.locator(".formation-row").count())
    await page
      .locator(".formation-row")
      .first()
      .getByRole("button", { name: "移除", exact: true })
      .click();
  for (const id of ["MS_14A", "RX_79_G", "MS_06F", "MS_06F"]) {
    await page.locator('[data-unit-id="' + id + '"]').click();
    await page.locator("#addFormationUnit").click();
  }
  await page.locator("#saveFormation").click();
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await page.locator("#roomMapSelect").selectOption("crossroads_2v2");
  await page.locator("#roomCostLimit").fill("700");
  await page.locator("#roomUnitCostLimit").fill("500");
  await waitForRoomSettings(page);
  await page.locator("#addAI2").click();
  await page.locator("#addAI3").click();
  for (const [team, tag] of [
    [0, "EFSF"],
    [1, "ZEON"],
  ]) {
    const rules = await page.evaluate(() => Net.snapshot.settings);
    rules.teamRestrictions[team] = { bannedFactions: [tag], bannedEras: [] };
    await page.evaluate((settings) => Net.request("configure_room", settings), rules);
    await expect.poll(() => page.evaluate(() => Net.awaiting)).toBeNull();
  }
  await page.locator("#aiSettings1").click();
  await page.locator("#ai-difficulty-1").selectOption("easy");

  await page.locator("#ai-fill-1").selectOption("50");
  await page.locator("#closeRoomDetail").click();
  await page.locator("#aiSettings2").click();
  await page.locator("#ai-difficulty-2").selectOption("hard");

  await page.locator("#ai-fill-2").selectOption("150");
  await page.locator("#closeRoomDetail").click();
  await page.locator("#aiSettings3").click();
  await expect(page.locator("#ai-difficulty-3")).toHaveValue("medium");
  await expect(page.locator("#ai-fill-3")).toHaveValue("100");
  await page.locator("#closeRoomDetail").click();
  await page.locator("#startRoomGame").click();
  await expect(page.locator("#finalAssemblyPanel")).toBeVisible();
  await expect(page.locator("#gameScene")).toBeHidden();
  await expect(page.locator(".final-squad")).toHaveCount(2);
  const self = await page.evaluate(() => Net.memberId),
    own = page.locator('.final-squad[data-member-id="' + self + '"]');
  await expect(own.locator(".final-unit-icon")).toHaveCount(4);
  await expect(own.locator(".overcost-label")).toHaveCount(2);
  const totalCost = await page.evaluate(() =>
    Formation.current().reduce(
      (sum, entry) => sum + UnitModels[entry.unitId + "__" + entry.kitId].cost,
      0,
    ),
  );
  await expect(own).toContainText("编组COST: " + totalCost + " / 700");
  await page.screenshot({ path: ".openai/final-assembly.png" });
  await page.locator("#editFinalFormation").click();
  await expect(page.locator(".formation-row.unit-disabled")).toHaveCount(2);
  await page.locator('[data-unit-id="MS_06F"]').click();
  await page.locator("#addFormationUnit").click();
  await page.locator("#saveFormation").click();
  await expect(own.locator(".final-unit-icon")).toHaveCount(5);
  await page.locator("#confirmFinalFormation").click();
  await expect(page.locator("#deploymentPanel")).toBeVisible();
  expect(
    await page.evaluate(() => game.units.filter((u) => u.ownerSeat === 0).map((u) => u.model)),
  ).toEqual(Array(3).fill("MS_06F__machine_gun"));
  expect(
    await page.evaluate(() => game.units.filter((u) => u.ownerSeat === 0).map((u) => u.id)),
  ).toEqual(["0-2", "0-3", "0-4"]);
  expect(
    await page.evaluate(() =>
      game.units
        .filter((u) => u.ownerSeat === 1)
        .every((u) => u.performance === 0.75 && UnitModels[u.model].faction === "EFSF"),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      game.units
        .filter((u) => u.ownerSeat === 2)
        .every((u) => u.performance === 1.25 && UnitModels[u.model].faction === "ZEON"),
    ),
  ).toBe(true);
  await page.locator("#confirmDeployment").click();
  await expect.poll(() => page.evaluate(() => phase)).toBe("idle");
  expect(errors).toEqual([]);
});

test("online allies review only their team, edits retain confirmation and reload resumes final assembly", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  const { createServer } = require("../server.js"),
    app = createServer({ host: "127.0.0.1", port: 0 }),
    address = await app.listen();
  const ally = await context.newPage(),
    watch = await context.newPage(),
    errors = [];
  for (const p of [page, ally, watch]) p.on("pageerror", (e) => errors.push(e.message));
  async function connect(p, name) {
    await p.goto("http://127.0.0.1:" + address.port);
    await p.locator("#playerId").fill(name);
    await p.locator("#openSkirmish").click();
    await p.locator("#openRooms").click();
    await p.locator("#serverAddress").fill("127.0.0.1:" + address.port);
    await p.locator("#connectServer").click();
    await expect(p.locator("#lobby")).toBeVisible();
  }
  try {
    await connect(page, "Host");
    await page.locator("#roomCode").fill("FINALS");
    await page.locator("#createRoom").click();
    await page.locator("#roomMapSelect").selectOption("crossroads_2v2");
    await waitForRoomSettings(page);
    await page.locator("#addAI1").click();
    await page.locator("#addAI3").click();
    for (const [p, name] of [
      [ally, "Ally"],
      [watch, "Watcher"],
    ]) {
      await connect(p, name);
      await p.locator(".room-card").filter({ hasText: "FINALS" }).getByRole("button").click();
      await expect(p.locator("#roomPreparation")).toBeVisible();
    }
    await ally.locator("#aiSettings1").click();
    await expect(ally.locator("#ai-difficulty-1")).toBeDisabled();
    await ally.locator("#closeRoomDetail").click();
    await expect(page.locator('.spawn-slot[data-seat="0"] .lineup-ready')).toHaveCSS(
      "color",
      "rgb(102, 213, 255)",
    );
    await expect(page.locator('.spawn-slot[data-seat="1"] .lineup-ready')).toHaveCSS(
      "color",
      "rgb(240, 206, 103)",
    );
    await expect(page.locator("#toggleReady")).toBeHidden();
    await expect(page.locator("#startRoomGame")).toBeDisabled();
    await ally.locator("#toggleReady").click();
    await expect(page.locator("#startRoomGame")).toBeEnabled();
    await expect(page.locator("#finalAssemblyPanel")).toBeHidden();
    await page.locator("#startRoomGame").click();
    for (const p of [page, ally]) {
      await expect(p.locator("#finalAssemblyPanel")).toBeVisible();
      await expect(p.locator(".final-squad")).toHaveCount(2);
      expect(
        await p.evaluate(() => Net.snapshot.assembly.players.every((p) => p.seat % 2 === 0)),
      ).toBe(true);
    }
    await expect(watch.locator(".final-squad")).toHaveCount(4);
    await expect(watch.locator("#confirmFinalFormation")).toBeHidden();
    for (const status of await page.locator(".final-squad .ready-status").all())
      await expect(status).toHaveCSS("color", "rgb(102, 213, 255)");
    await expect(watch.locator(".final-squad .ready-status.is-ready")).toHaveCount(2);
    for (const status of await watch.locator(".final-squad .ready-status.is-ready").all())
      await expect(status).toHaveCSS("color", "rgb(240, 206, 103)");
    await page.locator("#confirmFinalFormation").click();
    await expect(page.locator(".final-squad .ready-status.is-ready")).toHaveCSS(
      "color",
      "rgb(240, 206, 103)",
    );
    await expect(page.locator("#confirmFinalFormation")).toBeDisabled();
    await ally.locator("#editFinalFormation").click();
    await expect(ally.locator("#formationUnitCostLimit")).toBeVisible();
    await expect(ally.locator("#formationUnitCostLimit")).toHaveText("单位COST上限: 500");
    await ally.locator('[data-unit-id="MS_06F"]').click();
    await ally.locator("#addFormationUnit").click();
    await ally.locator("#saveFormation").click();
    await expect(page.locator("#confirmFinalFormation")).toBeDisabled();
    await expect(page.locator(".final-squad .ready-status.is-ready")).toHaveCount(1);
    await expect(page.locator(".final-squad .ready-status.is-ready")).toHaveCSS(
      "color",
      "rgb(240, 206, 103)",
    );
    await page.reload();
    await expect(page.locator("#finalAssemblyPanel")).toBeVisible();
    await expect(page.locator("#gameScene")).toBeHidden();
    await expect(page.locator("#confirmFinalFormation")).toBeDisabled();
    await ally.locator("#confirmFinalFormation").click();
    for (const p of [page, ally]) await expect(p.locator("#deploymentPanel")).toBeVisible();
    await page.locator("#confirmDeployment").click();
    await ally.locator("#confirmDeployment").click();
    await expect.poll(() => page.evaluate(() => phase)).toBe("idle");
    expect(errors).toEqual([]);
  } finally {
    await ally.close();
    await watch.close();
    await page.close();
    await app.close();
  }
});

test("new high-tier native parts, eye, shield and weapon variants render in both facings", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  const count = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 720;
    canvas.style.cssText = "position:fixed;inset:0;z-index:9999;background:#162935";
    document.body.append(canvas);
    const ctx = canvas.getContext("2d"),
      ids = ["MS_14A__beam_rifle", "MS_14A__bazooka", "RX_79_G__beam_rifle", "RX_79_G__cannon"];
    const eye = SpriteRenderer.models[ids[0]].decals.find((d) => d.name === "Eye"),
      original = ctx.drawImage;
    let count = 0;
    ctx.drawImage = function (image, ...args) {
      if (image === SpriteRenderer.images[eye.asset]) count++;
      return original.call(this, image, ...args);
    };
    for (const [i, id] of ids.entries()) {
      ctx.fillStyle = "#ffffff";
      ctx.font = "18px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(UnitModels[id].name + " / " + UnitModels[id].kitName, 150 + i * 300, 30);
      SpriteRenderer.draw(ctx, id, 150 + i * 300, 190, 3, 90, null, 0, null, false, true);
      SpriteRenderer.draw(
        ctx,
        id,
        150 + i * 300,
        530,
        3,
        -90,
        "Common_Shoot_A",
        0.4,
        null,
        false,
        true,
      );
    }
    return count;
  });
  expect(count).toBe(4);
  await page.screenshot({ path: ".openai/high-tier-units.png" });
  expect(errors).toEqual([]);
});

test("new AI and final formation controls localize in English and Japanese", async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await page.evaluate(() => I18n.setLanguage("en"));
  await page.locator("#aiSettings1").click();
  await expect(page.locator("#ai-difficulty-1 option").first()).toHaveText("Easy · 75%");
  await page.locator("#ai-difficulty-1").selectOption("hard");
  await page.locator("#closeRoomDetail").click();
  await page.locator("#startRoomGame").click();
  await expect(page.locator("#finalAssemblyTitle")).toHaveText("Final formation");
  await expect(page.locator("#confirmFinalFormation")).toHaveText("Confirm sortie formation");
  await page.evaluate(() => I18n.setLanguage("ja"));
  await expect(page.locator("#finalAssemblyTitle")).toHaveText("最終編成");
  await expect(page.locator("#confirmFinalFormation")).toHaveText("出撃編成を確定");
  await page.locator("#confirmFinalFormation").click();
  await expect(page.locator("#deploymentPanel")).toBeVisible();
  const names = await page.evaluate(() => {
    const u = game.units.find((u) => u.ownerSeat === 1);
    const m = Rules.modelOf(u);
    I18n.setLanguage("en");
    return {
      unit: Rules.modelOf(u).name,
      base: UnitModels[u.model].name,
      weapon: m.weapons[0].name,
      baseWeapon: UnitModels[u.model].weapons[0].name,
    };
  });
  expect(names.unit).toBe(names.base);
  expect(names.weapon).toBe(names.baseWeapon);
});
