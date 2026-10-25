const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
const { createServer } = require("../server.js");
const custom = "吉姆<1>";
async function rename(page) {
  await page.locator("#openFormation").click();
  await page
    .locator(".formation-row")
    .first()
    .getByRole("button", { name: "详情", exact: true })
    .click();
  await page.locator("#formationDetailName").fill(custom);
  await page.locator("#formationDetailKit").selectOption("machine_gun");
  await expect(page.locator("#formationDetailName")).toHaveValue(custom);
  await page.locator("#closeFormationDetail").click();
  await expect(page.locator(".formation-row").first()).toContainText(custom);
  await page.locator("#saveFormation").click();
}
test("unit detail renames only one entry, survives reload and reset restores the localized default", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await rename(page);
  await page.reload();
  await page.locator("#openFormation").click();
  await expect(page.locator(".formation-row").first()).toContainText(custom);
  await page
    .locator(".formation-row")
    .first()
    .getByRole("button", { name: "详情", exact: true })
    .click();
  await page.evaluate(() => I18n.setLanguage("en"));
  await expect(page.locator("#formationDetailTitle")).toContainText(custom);
  await page.locator("#resetFormationUnitName").click();
  await expect(page.locator("#formationDetailName")).toHaveValue("");
  await expect(page.locator("#formationDetailTitle")).toContainText("GM");
  await expect(page.locator("#resetFormationUnitName")).toBeDisabled();
  await page.locator("#closeFormationDetail").click();
  await page.locator("#saveFormation").click();
  expect(await page.evaluate(() => !Formation.current()[0].customName)).toBe(true);
});
test("two clients receive custom names in battle, action logs and reconnect snapshots as literal text", async ({
  browser,
}) => {
  test.setTimeout(60000);
  const app = createServer({ host: "127.0.0.1", port: 0 }),
    address = await app.listen();
  const contexts = await Promise.all([
    browser.newContext({ locale: "zh-CN" }),
    browser.newContext({ locale: "zh-CN" }),
  ]);
  const pages = await Promise.all(contexts.map((c) => c.newPage())),
    [host, guest] = pages,
    errors = [];
  async function settled(p) {
    await expect.poll(() => p.evaluate(() => Net.awaiting)).toBeNull();
  }
  async function connect(p) {
    await p.locator("#openSkirmish").click();
    await p.locator("#openRooms").click();
    await p.locator("#serverAddress").fill("127.0.0.1:" + address.port);
    await p.locator("#connectServer").click();
    await expect(p.locator("#lobby")).toBeVisible();
  }
  try {
    for (const p of pages) {
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto("http://127.0.0.1:" + address.port);
    }
    await rename(host);
    await connect(host);
    await host.locator("#roomCode").fill("UNITNAMES");
    await host.locator("#createRoom").click();
    await expect(host.locator("#roomPreparation")).toBeVisible();
    await connect(guest);
    await guest.locator(".room-card").filter({ hasText: "UNITNAMES" }).getByRole("button").click();
    await expect(guest.locator("#roomPreparation")).toBeVisible();
    await guest.locator("#toggleReady").click();
    await settled(guest);
    await host.locator("#startRoomGame").click();
    await expect(host.locator(".final-unit-icon").first()).toHaveAttribute(
      "title",
      new RegExp(custom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    for (const p of pages) {
      await p.locator("#confirmFinalFormation").click();
      await settled(p);
    }
    for (const p of pages) {
      await p.locator("#confirmDeployment").click();
      await settled(p);
    }
    for (const p of pages) await expect.poll(() => p.evaluate(() => phase)).toBe("idle");
    expect(await guest.evaluate(() => game.units.find((u) => u.id === "0-0").customName)).toBe(
      custom,
    );
    const room = app.rooms.get("UNITNAMES"),
      a = room.game.units.find((u) => u.id === "0-0"),
      b = room.game.units.find((u) => u.id === "1-0");
    Object.assign(a, { x: 2, y: 4 });
    Object.assign(b, { x: 4, y: 4, hp: 100000, shield: 0 });
    room.game.tiles[4][2] = room.game.tiles[4][4] = "plain";
    await host.evaluate(() => Net.request("sync"));
    await settled(host);
    await host.evaluate(() =>
      Net.request("attack", { unitId: "0-0", targetId: "1-0", weaponId: "EF_90mmMG" }),
    );
    await settled(host);
    await host.evaluate(() => Net.request("end_turn"));
    await settled(host);
    await expect(guest.locator("#reaction")).toBeVisible();
    await expect(guest.locator("#engagement")).toContainText(custom);
    await guest.locator("#responseDefend").click();
    await guest.locator("#confirmResponse").click();
    await expect
      .poll(() =>
        room.log.some(
          (line) => line.includes(custom) && line.includes("使用") && !line.includes("计划"),
        ),
      )
      .toBe(true);
    await guest.evaluate(() => I18n.setLanguage("en"));
    await expect(guest.locator("#roomCombatLog")).toContainText(custom);
    expect(await guest.locator("#roomCombatLog b").count()).toBe(0);
    await guest.evaluate(() => Net.socket.close());
    await expect(guest.locator("#disconnectDialog")).toBeVisible();
    await guest.locator("#reconnectRoom").click();
    await expect(guest.locator("#disconnectDialog")).not.toBeVisible();
    expect(await guest.evaluate(() => game.units.find((u) => u.id === "0-0").customName)).toBe(
      custom,
    );
    await host.evaluate(() => Net.request("return_room"));
    await expect(guest.locator("#roomPreparation")).toBeVisible();
    await expect(guest.locator("#roomCombatLog")).toContainText(custom);
    expect(await guest.evaluate(() => Net.snapshot.logNames)).toContain(custom);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
    await app.close();
  }
});
test("adding units generates distinct named entries and persists their codes", async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.locator("#openFormation").click();
  await page.locator("#openFormationPicker").click();
  await page.locator('[data-unit-id="RGM_79"]').click();
  for (let i = 0; i < 2; i++) await page.locator("#addFormationUnit").click();
  await page.locator("#closeFormationPicker").click();
  const names = [];
  for (let i = 0; i < 2; i++) {
    await page
      .locator(".formation-row")
      .nth(3 + i)
      .getByRole("button", { name: "详情", exact: true })
      .click();
    const name = await page.locator("#formationDetailName").inputValue();
    expect(name).toMatch(/^吉姆\[[A-Z]\d{2}\]$/);
    names.push(name);
    await page.locator("#closeFormationDetail").click();
  }
  expect(names[0]).not.toBe(names[1]);
  await page.locator("#saveFormation").click();
  await page.reload();
  expect(
    await page.evaluate(() =>
      Formation.current()
        .slice(-2)
        .map((e) => e.customName),
    ),
  ).toEqual(names);
});
