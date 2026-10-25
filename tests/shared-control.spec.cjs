const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
async function room(page) {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.evaluate(async () => {
    await SpriteRenderer.load();
    I18n.setLanguage("zh");
    LocalRoom.open();
    await new Promise((r) => setTimeout(r, 0));
  });
}
async function battle(page) {
  await page.locator("#startRoomGame").click();
  await page.locator("#confirmFinalFormation").click();
  await expect(page.locator("#confirmDeployment")).toBeVisible();
}
test("room filters align on desktop and phone and global sharing grants allied unit control", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await room(page);
  await page.locator("#roomMapSelect").selectOption("crossroads_2v2");
  await page.locator("#addAI2").click();
  await page.locator(".team-filters").first().locator("summary").click();
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const boxes = await page
      .locator(".team-filters")
      .first()
      .locator("select")
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
    expect(boxes.length).toBe(3);
    for (const box of boxes) {
      expect(box.width).toBeGreaterThan(60);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(viewport.width);
    }
    if (viewport.width > 600)
      expect(
        Math.max(...boxes.map((b) => b.top)) - Math.min(...boxes.map((b) => b.top)),
      ).toBeLessThan(2);
    else expect(boxes[1].top).toBeGreaterThan(boxes[0].bottom);
    await page.screenshot({ path: `.openai/room-sharing-${viewport.width}.png` });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.locator("#roomShareAlliedUnits").check();
  expect(await page.evaluate(() => Net.snapshot.settings.shareAlliedUnits)).toBe(true);
  await battle(page);
  await expect(page.locator("#helpBtn")).toBeHidden();
  const control = await page.evaluate(() => {
    const u = game.units.find((u) => Rules.ownerOf(u) === 2);
    return { shared: Net.canControl(u), own: Net.owns(u) };
  });
  expect(control).toEqual({ shared: true, own: false });
  await page.locator("#roomSettings").click();
  await expect(page.locator("#roomFormationSelect")).toBeHidden();
  await expect(page.locator("#roomFormation")).toBeHidden();
  await expect(page.locator("#shareUnitsToAllies")).toBeVisible();
  await expect(page.locator("#shareUnitsToAllies")).toBeDisabled();
  expect(errors).toEqual([]);
});
test("battle seat panel offers personal sharing even when the room option is off", async ({
  page,
}) => {
  await room(page);
  await battle(page);
  await page.locator("#roomSettings").click();
  expect(await page.evaluate(() => Net.snapshot.settings.shareAlliedUnits)).toBe(false);
  await page.locator("#shareUnitsToAllies").click();
  await expect(page.locator("#shareUnitsToAllies")).toHaveText("已共享单位给友军");
  expect(
    await page.evaluate(() => Net.snapshot.members.find((m) => m.id === Net.memberId).shareUnits),
  ).toBe(true);
  await expect(page.locator("#shareUnitsToAllies")).toBeDisabled();
});


test("room type bans and AI seat management", async ({ page }) => {
  await room(page);
  await page.locator("#roomMapSelect").selectOption("crossroads_2v2");
  const types = page.locator('#roomTagRestrictions select').nth(2);
  await expect(types).toBeVisible();
  const tag = await types.locator('option').evaluateAll(options => options.find(o => o.value && !['ALL', 'NONE'].includes(o.value))?.value);
  await types.selectOption(tag);
  expect(await page.evaluate(() => Net.snapshot.settings.bannedTypes.length)).toBeGreaterThan(0);
  expect(await page.locator('.room-options input').evaluateAll(els => els.map(e => e.id))).toEqual(['roomCostLimit', 'roomUnitCostLimit', 'roomUnitLimit']);
  await page.locator('#aiSettings1').click();
  await expect(page.locator('#managePlayerSeat option[value="spectator"]')).toHaveCount(0);
  await expect(page.locator('#managePlayerSeat option[value="0"]')).toHaveCount(0);
  const id = await page.evaluate(() => Net.snapshot.members.find(m => m.bot && m.seat === 1).id);
  await page.locator('#managePlayerSeat').selectOption('3');
  await page.locator('#applyPlayerSeat').click();
  await expect(page.locator('#managePlayerSeat')).toHaveValue('3');
  expect(await page.evaluate(id => Net.snapshot.members.find(m => m.id === id).seat, id)).toBe(3);
  await page.evaluate(id => Net.request('move_player', { memberId: id, seat: null }), id);
  await expect.poll(() => page.evaluate(() => !!Net.awaiting)).toBe(false);
  expect(await page.evaluate(id => Net.snapshot.members.find(m => m.id === id).seat, id)).toBe(3);
});

