const { waitForRoomSettings } = require("./room-settings-fixture.cjs");
const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
const fileURL = pathToFileURL(path.resolve("public/client.html")).href;
test("unlimited saved formations, era tags, default room caps and full-row panels share tail priority", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(fileURL);
  await page.locator("#openFormation").click();
  await expect(page.locator("#formationBudget")).toContainText("编组COST: 1175 / 无限");
  await expect(page.locator("#formationBudget")).toContainText("单位COST上限: 无限");
  await expect(page.locator("#formationEra option")).toHaveCount(2);
  await page.locator("#formationEra").selectOption("0079");
  await expect(page.locator(".catalog-unit")).toHaveCount(11);
  await expect(page.locator('[data-unit-id="MS_06F2"] .faction-tag')).toHaveText("ZEON");
  while (await page.locator(".formation-row").count())
    await page
      .locator(".formation-row")
      .first()
      .getByRole("button", { name: "移除", exact: true })
      .click();
  for (const id of ["RGM_79", "MS_14A", "MS_06F2", "RGM_79L", "MS_06F"]) {
    await page.locator('[data-unit-id="' + id + '"]').click();
    await page.locator("#addFormationUnit").click();
  }
  await expect(page.locator(".formation-row.unit-disabled")).toHaveCount(0);
  await page.locator("#saveFormation").click();
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await expect(page.locator("#roomCostLimit")).toHaveValue("3000");
  await expect(page.locator("#roomUnitCostLimit")).toHaveValue("500");
  await page.locator("#roomUnitCostLimit").fill("500");
  await waitForRoomSettings(page);
  await page.locator("#roomFormation").click();
  await expect(page.locator("#formationUnitCostLimit")).toBeVisible();
  await expect(page.locator("#formationUnitCostLimit")).toHaveText("单位COST上限: 500");
  await expect(page.locator("#formationUnitCostLimit")).toHaveClass(/has-limit/);
  await expect(page.locator(".formation-row.overcost")).toHaveCount(1);
  const disabled = page.locator(".formation-row.overcost").first();
  await expect(disabled.locator(".overcost-label")).toHaveText("OVER COST");
  const layers = await disabled.evaluate((row) => {
    const panel = row.querySelector(".disabled-panel"),
      label = row.querySelector(".overcost-label"),
      a = row.getBoundingClientRect(),
      b = panel.getBoundingClientRect();
    return {
      width: a.width - panel.getBoundingClientRect().width,
      height: a.height - b.height,
      panel: Number(getComputedStyle(panel).zIndex),
      label: Number(getComputedStyle(label).zIndex),
      background: getComputedStyle(panel).backgroundColor,
    };
  });
  expect(Math.abs(layers.width)).toBeLessThan(2);
  expect(Math.abs(layers.height)).toBeLessThan(2);
  expect(layers.label).toBeGreaterThan(layers.panel);
  expect(layers.background).toBe("rgba(0, 0, 0, 0.62)");
  await page.locator("#saveFormation").click();
  await page.locator("#roomCostLimit").fill("700");
  await waitForRoomSettings(page);
  await page.locator("#roomFormation").click();
  await expect(page.locator(".formation-row.unit-disabled")).toHaveCount(4);
  await expect(page.locator(".formation-row").first()).not.toHaveClass(/unit-disabled/);
  await page.screenshot({ path: ".openai/tail-overcost-roster.png" });
  await page.locator("#saveFormation").click();
  await page.locator("#roomCostLimit").fill("5000");
  await page.locator("#roomBan-bannedFactions").selectOption("ZEON");
  await waitForRoomSettings(page);
  await page.locator("#roomFormation").click();
  await expect(page.locator(".formation-row.not-allowed")).toHaveCount(3);
  await expect(page.locator(".formation-row.not-allowed .overcost-label").first()).toHaveText(
    "不被允许的单位",
  );
  await page.locator("#saveFormation").click();
  const team = page.locator(".team-slot").first();
  await team.locator("summary").click();
  await page.locator("#teamBan-0-bannedFactions").selectOption("EFSF");

  await expect(page.locator("#startRoomGame")).toBeDisabled();
  await page.locator("#roomFormation").click();
  await expect(page.locator(".formation-row.not-allowed")).toHaveCount(5);
  await page.evaluate(() => I18n.setLanguage("en"));
  await expect(page.locator("#formationBudget")).toContainText("Squad COST");
  await expect(page.locator(".formation-row.not-allowed .overcost-label").first()).toHaveText(
    "Unit not allowed",
  );
  expect(errors).toEqual([]);
});
test("room join controls sit in team headers, AI settings stay in a dialog and host moves and kicks players", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  const { createServer } = require("../server.js"),
    app = createServer({ host: "127.0.0.1", port: 0 }),
    address = await app.listen(),
    guest = await context.newPage();
  const errors = [];
  for (const p of [page, guest]) p.on("pageerror", (e) => errors.push(e.message));
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
    await page.locator("#createRoom").click();
    await page.locator("#roomCode").fill("NEWTOOLS");
    await page.locator('#roomCreateForm button[type="submit"]').click();
    await page.locator("#roomMapSelect").selectOption("crossroads_2v2");
    await waitForRoomSettings(page);
    await page.locator("#addAI3").click();
    await connect(guest, "Guest");
    await guest.locator(".room-card").filter({ hasText: "NEWTOOLS" }).getByRole("button").click();
    await expect(page.locator(".team-heading #joinTeam1")).toBeVisible();
    await expect(page.locator("#roomActions #joinTeam1")).toHaveCount(0);
    await expect(guest.locator("#roomUnitCostLimit")).toBeDisabled();
    await expect(guest.locator("#roomBan-bannedFactions")).toBeDisabled();
    await expect(guest.locator('[id^="managePlayer-"]')).toHaveCount(0);
    const heights = await page.evaluate(() =>
      [...document.querySelectorAll(".spawn-slot")]
        .filter((row) => row.querySelector(".player-name"))
        .map((row) => row.getBoundingClientRect().height),
    );
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(12);
    await page.locator("#aiSettings3").click();
    await expect(page.locator("#ai-faction-3")).toHaveCount(0);
    await page.locator("#ai-difficulty-3").selectOption("hard");
    await expect(page.locator("#ai-difficulty-3")).toHaveValue("hard");
    await page.locator("#closeRoomDetail").click();
    await page.locator(".team-slot").nth(1).locator("summary").click();
    await page.locator("#teamBan-1-bannedFactions").selectOption("EFSF");

    await guest.locator("#roomFormation").click();
    await expect(guest.locator(".formation-row.not-allowed")).toHaveCount(3);
    const target = await guest.evaluate(() => Net.memberId);
    await page.locator('[id="managePlayer-' + target + '"]').click();
    await expect(page.locator('#managePlayerSeat option[value="3"]')).toHaveCount(0);
    await page.locator("#managePlayerSeat").selectOption("2");
    await page.locator("#applyPlayerSeat").click();
    await expect.poll(() => guest.evaluate(() => Net.seat)).toBe(2);
    await expect(guest.locator("#formationScreen")).toBeVisible();
    await expect(guest.locator(".formation-row.unit-disabled")).toHaveCount(0);
    await page.locator("#managePlayerSeat").selectOption("spectator");
    await page.locator("#applyPlayerSeat").click();
    await expect.poll(() => guest.evaluate(() => Net.seat)).toBeNull();
    await page.locator("#closeRoomDetail").click();
    await guest.locator("#saveFormation").click();
    await expect(page.locator("#spectatorSlots")).toContainText("Guest");
    await page.locator('#spectatorSlots [id="managePlayer-' + target + '"]').click();
    await page.locator("#kickPlayer").click();
    await expect(guest.locator("#openSkirmish")).toBeVisible();
    await expect(page.locator("#roomDetailPanel")).toBeHidden();
    await page.screenshot({ path: ".openai/room-new-controls.png" });
    expect(errors).toEqual([]);
  } finally {
    await guest.close();
    await page.close();
    await app.close();
  }
});
test("MS-06F2 renders native eye, three kits and Panzerfaust on both facings", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(fileURL);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  const eyes = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 650;
    canvas.style.cssText = "position:fixed;inset:0;z-index:9999;background:#152935";
    document.body.append(canvas);
    const ctx = canvas.getContext("2d"),
      modes = [
        ["machine_gun", null],
        ["bazooka", null],
        ["anti_air", null],
        ["machine_gun", "ZN_Panzerfaust"],
      ];
    let eyes = 0;
    const eye = SpriteRenderer.models.MS_06F2__machine_gun.decals.find((d) => d.name === "Eye"),
      draw = ctx.drawImage;
    ctx.drawImage = function (image, ...args) {
      if (image === SpriteRenderer.images[eye.asset]) eyes++;
      return draw.call(this, image, ...args);
    };
    modes.forEach(([kit, weapon], index) => {
      const id = "MS_06F2__" + kit,
        m = UnitModels[id];
      ctx.fillStyle = "#fff";
      ctx.font = "18px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(weapon || m.kitName, 150 + index * 300, 30);
      SpriteRenderer.draw(ctx, id, 150 + index * 300, 180, 3, 90, null, 0, weapon, false, true);
      SpriteRenderer.draw(ctx, id, 150 + index * 300, 490, 3, -90, null, 0, weapon, false, true);
    });
    return eyes;
  });
  expect(eyes).toBe(8);
  await page.screenshot({ path: ".openai/ms-06f2-native-gallery.png" });
  expect(errors).toEqual([]);
});
