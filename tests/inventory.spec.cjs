const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;
async function seed(page, { money = 5000, supplies = 10000, owned = 1, count = 4 } = {}) {
  await page.addInitScript(
    ({ money, supplies, owned, count }) => {
      if (localStorage.getItem("stock-ui-seeded")) return;
      localStorage.setItem("stock-ui-seeded", "yes");
      localStorage.setItem("projectgreed.combatFaction", "PMC");
      localStorage.setItem(
        "projectgreed.economy.v1",
        JSON.stringify({ money, supplies, inventory: { Type61: owned }, kits: {} }),
      );
      localStorage.setItem(
        "slg-formations-v1.PMC",
        JSON.stringify({
          version: 3,
          squads: [
            {
              name: "库存编组",
              units: Array.from({ length: count }, () => ({ unitId: "Type61", kitId: "standard" })),
            },
          ],
        }),
      );
    },
    { money, supplies, owned, count },
  );
  await page.goto(url);
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(() => I18n.setLanguage("zh"));
}
for (const width of [1280, 390])
  test(`formation stock overlays, production navigation and picker points at ${width}px`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    await seed(page);
    await page.locator("#openFormation").click();
    await expect(page.locator('[data-formation-index="0"] .formation-inventory-count')).toHaveText(
      "持有 1 台 · 编组需要 4 台",
    );
    const row = page.locator('[data-formation-index="1"]');
    await expect(row.locator(".inventory-shortage-prompt > span")).toHaveText("数量不足");
    await expect(row.locator(".disabled-panel")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0.62)",
    );
    const center = await row.locator(".inventory-shortage-prompt").boundingBox();
    const actions = await row.locator(".formation-row-actions").boundingBox();
    const mask = await row.locator(".disabled-panel").boundingBox();
    expect(center.x + center.width).toBeLessThanOrEqual(actions.x);
    expect(mask.x + mask.width).toBeLessThanOrEqual(actions.x);
    const footer = await page.evaluate(() => {
      const r = (id) => byId(id).getBoundingClientRect();
      return {
        back: r("saveFormation").right,
        buyLeft: r("produceMissingFormation").left,
        buyRight: r("produceMissingFormation").right,
        faction: r("formationGroup").left,
      };
    });
    expect(footer.buyLeft).toBeGreaterThanOrEqual(footer.back);
    expect(footer.faction).toBeGreaterThanOrEqual(footer.buyRight);
    await page.screenshot({ path: `.openai/stock-formation-${width}.png` });
    await row.locator(".produce-shortage-unit").click();
    await expect(page.locator("#productionScreen")).toBeVisible();
    await expect(page.locator("#productionUnitName")).toContainText("61式");
    await page.locator("#produceUnit").click();
    await page.locator("#closeProduction").click();
    await expect(page.locator("#formationScreen")).toBeVisible();
    await expect(page.locator(".inventory-shortage")).toHaveCount(0);
    await expect(page.locator("#produceMissingFormation")).toBeHidden();
    await page.locator("#openFormationPicker").click();
    await expect(page.locator("#formationPickerUnitPoints")).toContainText("编组单位点数: 4 /");
    const rect = await page.locator("#formationPickerUnitPoints").boundingBox();
    expect(rect.x).toBeGreaterThan(width / 3);
    expect(errors).toEqual([]);
  });
test("one-click production completes all shortages, and insufficient currency leaves everything unchanged", async ({
  page,
}) => {
  await seed(page, { owned: 0, count: 7 });
  await page.locator("#openFormation").click();
  await page.locator("#produceMissingFormation").click();
  expect(await page.evaluate(() => Economy.quantity("Type61"))).toBe(9);
  await expect(page.locator(".inventory-shortage")).toHaveCount(0);
  await page.evaluate(() => {
    const data = ProfileSave.exportData();
    data.economy = { money: 0, supplies: 10000, inventory: {}, kits: {} };
    ProfileSave.importData(data);
  });
  await page.reload();
  await page.waitForFunction(() => assetsReady);
  await page.locator("#openFormation").click();
  const before = await page.evaluate(() => Economy.snapshot());
  await page.locator("#produceMissingFormation").click();
  await expect(page.locator("#toast")).toContainText("货币不足");
  expect(await page.evaluate(() => Economy.snapshot())).toEqual(before);
});
test("shortage readiness offers cancel, warehouse and force, and warehouse production clears the warning", async ({
  page,
}) => {
  await seed(page);
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await page.locator("#startRoomGame").click();
  await expect(page.locator("#gameDialog")).toBeVisible();
  await expect(page.locator("#gameDialog .game-dialog-actions button")).toHaveText([
    "取消",
    "去往仓库（编组）",
    "强制准备",
  ]);
  await page.locator("#cancelMissingStock").click();
  expect(await page.evaluate(() => Net.snapshot.started)).toBe(false);
  await page.locator("#startRoomGame").click();
  await page.locator("#openStockWarehouse").click();
  await expect(page.locator("#formationScreen")).toBeVisible();
  await expect(page.locator("#produceMissingFormation")).toHaveClass(/inventory-attention/);
  await page.locator("#saveFormation").click();
  await page.locator("#startRoomGame").click();
  await page.locator("#forceReadyWithoutStock").click();
  await expect(page.locator("#finalAssemblyPanel")).toBeVisible();
  await expect(page.locator(".final-squad").first().locator(".overcost-label")).toHaveText([
    "库存不足",
    "库存不足",
    "库存不足",
  ]);
  await page.locator("#confirmFinalFormation").click();
  await page.locator("#openStockWarehouse").click();
  await page.locator("#produceMissingFormation").click();
  await page.locator("#saveFormation").click();
  await page.locator("#confirmFinalFormation").click();
  await expect.poll(() => page.evaluate(() => Net.snapshot?.phase)).toBe("deployment");
  expect(
    await page.evaluate(
      () => Net.snapshot.game.units.filter((u) => u.ownerSeat === Net.seat).length,
    ),
  ).toBe(4);
});

test("guest Ready supports cancellation and explicit forced readiness without purchasing", async ({
  page,
  browser,
}) => {
  const app = require("../server.js").createServer({ host: "127.0.0.1", port: 0 }),
    address = await app.listen();
  const guestContext = await browser.newContext(),
    guest = await guestContext.newPage();
  async function lobby(p) {
    await seed(p);
    await p.locator("#openSkirmish").click();
    await p.locator("#openRooms").click();
    await p.locator("#serverAddress").fill("127.0.0.1:" + address.port);
    await p.locator("#connectServer").click();
    await expect(p.locator("#lobby")).toBeVisible();
  }
  try {
    await lobby(page);
    await page.evaluate(() => Net.connect("create", false, "STOCKUI"));
    await expect(page.locator("#roomPreparation")).toBeVisible();
    await lobby(guest);
    await guest.evaluate(() => Net.connect("join", false, "STOCKUI"));
    await expect(guest.locator("#toggleReady")).toBeVisible();
    await guest.locator("#toggleReady").click();
    await guest.locator("#cancelMissingStock").click();
    await expect(guest.locator("#toggleReady")).toHaveText("准备");
    await guest.locator("#toggleReady").click();
    await guest.locator("#forceReadyWithoutStock").click();
    await expect(guest.locator("#toggleReady")).toHaveText("取消准备");
    expect(await guest.evaluate(() => Economy.quantity("Type61"))).toBe(1);
    const room = app.rooms.get("STOCKUI");
    expect(room.seats[1].inventory.Type61).toBe(1);
    await page.locator("#startRoomGame").click();
    await page.locator("#forceReadyWithoutStock").click();
    await expect(page.locator("#finalAssemblyPanel")).toBeVisible();
    await expect(page.locator(".final-squad").first().locator(".overcost-label")).toHaveText([
      "库存不足",
      "库存不足",
      "库存不足",
    ]);
  } finally {
    await page.evaluate(() => Net.leave()).catch(() => {});
    await guestContext.close();
    await app.close();
  }
});

for (const width of [1280, 390])
  test(`undeveloped units show inline warnings and production can cancel or remove them without spending at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await seed(page);
    await page.locator("#openFormation").click();
    await page.locator("#openFormationPicker").click();
    await page.locator("#formationSearch").fill("RX_78_2");
    const card = page.locator('#formationCatalog [data-unit-id="RX_78_2"]');
    await expect(card.locator(".unit-undeveloped")).toContainText("尚未开发");
    await expect(card.locator(".unit-warning-icon")).toBeVisible();
    await card.click();
    await expect(page.locator("#addFormationUnit")).toBeEnabled();
    await page.locator("#addFormationUnit").click();
    await page.locator("#closeFormationPicker").click();
    expect(await page.evaluate(() => Formation.current().some((e) => e.unitId === "RX_78_2"))).toBe(
      true,
    );
    const undevelopedRow = page.locator("#formationUnits .formation-row").filter({ hasText: "RX-78-2" });
    await expect(undevelopedRow.locator(".disabled-panel")).toHaveCount(0);
    await expect(undevelopedRow.locator(".unit-undeveloped")).toHaveCSS("color", "rgb(255, 116, 116)");
    const position = await undevelopedRow.evaluate((row) => {
      const stock = row.querySelector(".formation-inventory-count").getBoundingClientRect();
      const warning = row.querySelector(".unit-undeveloped").getBoundingClientRect();
      return { right: stock.right, left: warning.left, y: stock.y, warningY: warning.y };
    });
    expect(position.left).toBeGreaterThan(position.right);
    expect(Math.abs(position.y - position.warningY)).toBeLessThan(3);
    const before = await page.evaluate(() => Economy.snapshot());
    await page.locator("#produceMissingFormation").click();
    await expect(page.locator("#gameDialog")).toContainText("存在尚未开发单位，无法生产");
    await expect(page.locator(".game-dialog-list")).toContainText("RX-78-2");
    await expect(page.locator("#gameDialog .game-dialog-actions button")).toHaveText(["取消", "移除"]);
    expect(await page.evaluate(() => Economy.snapshot())).toEqual(before);
    await page.locator("#cancelRemoveUndeveloped").click();
    await expect(undevelopedRow).toBeVisible();
    await page.locator("#produceMissingFormation").click();
    await page.locator("#removeUndevelopedUnits").click();
    await expect(page.locator("#gameDialog")).not.toBeVisible();
    await expect(undevelopedRow).toHaveCount(0);
    expect(await page.evaluate(() => Economy.snapshot())).toEqual(before);
    expect(await page.evaluate(() => Formation.current().some((entry) => entry.unitId === "RX_78_2"))).toBe(false);
    await page.reload();
    await page.waitForFunction(() => assetsReady);
    expect(await page.evaluate(() => Formation.current().some((entry) => entry.unitId === "RX_78_2"))).toBe(false);
  });

test("removing an entirely undeveloped formation saves an empty draft that can be refilled", async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("empty-draft-seeded")) return;
    localStorage.setItem("empty-draft-seeded", "yes");
    localStorage.setItem("projectgreed.combatFaction", "PMC");
    localStorage.setItem("slg-formations-v1.PMC", JSON.stringify({ version: 3, squads: [{ name: "未开发编组", units: [{ unitId: "RX_78_2", kitId: "kit_0" }] }] }));
  });
  await page.goto(url);
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(() => I18n.setLanguage("zh"));
  await page.locator("#openFormation").click();
  await page.locator("#produceMissingFormation").click();
  await page.locator("#removeUndevelopedUnits").click();
  await expect(page.locator("#formationUnits .formation-row")).toHaveCount(0);
  expect(await page.evaluate(() => ProfileSave.validate(ProfileSave.exportData()).formations.PMC.squads[0].units)).toEqual([]);
  await page.reload();
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(() => I18n.setLanguage("zh"));
  await page.locator("#openFormation").click();
  await expect(page.locator("#formationUnits .formation-row")).toHaveCount(0);
  await page.locator("#openFormationPicker").click();
  await page.locator("#formationSearch").fill("Type61");
  await page.locator('#formationCatalog [data-unit-id="Type61"]').click();
  await page.locator("#addFormationUnit").click();
  await page.locator("#closeFormationPicker").click();
  await expect(page.locator("#formationUnits .formation-row")).toHaveCount(1);
});
