const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const { createServer } = require("../server.js");
const url = pathToFileURL(path.resolve("public/client.html")).href;
async function load(page, inventory = { Type61: 1 }) {
  await page.addInitScript((inventory) => {
    localStorage.setItem("projectgreed.combatFaction", "PMC");
    localStorage.setItem("projectgreed.economy.v1", JSON.stringify({ money: 1000000, supplies: 1000000, inventory, kits: {} }));
  }, inventory);
  await page.goto(url);
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(() => I18n.setLanguage("zh"));
}
test("bulk production confirms only shortage units and exact costs, cancellation never buys", async ({ page }) => {
  await load(page, { RX_78_2: 1 });
  const entries = [{ unitId: "RX_78_2", kitId: "standard" }, { unitId: "Type61", kitId: "standard" }];
  const before = await page.evaluate(() => Economy.snapshot());
  const begin = () => page.evaluate(entries => {
    window.purchaseFinished = false;
    Formation.replenish(entries, "PMC").then(result => { window.purchaseResult = result; window.purchaseFinished = true; });
  }, entries);
  await begin();
  await expect(page.locator("#gameDialog")).toBeVisible();
  await expect(page.locator("#gameDialogMessage")).toHaveText("是否一键生产补齐库存不足的单位？");
  const lines = await page.locator("#gameDialog .game-dialog-list li").allTextContents();
  expect(lines.length).toBe(3);
  expect(lines[0]).toContain("61");
  expect(lines.join(" ")).not.toContain("RX-78");
  const plan = await page.evaluate(entries => Economy.productionPlan(entries), entries);
  expect(lines[1]).toContain(plan.money.toLocaleString("en-US"));
  expect(lines[2]).toContain(plan.supplies.toLocaleString("en-US"));
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.waitForFunction(() => window.purchaseFinished);
  expect(await page.evaluate(() => Economy.snapshot())).toEqual(before);
  await begin();
  await page.getByRole("button", { name: "确认生产", exact: true }).click();
  await page.waitForFunction(() => window.purchaseFinished);
  expect(await page.evaluate(() => window.purchaseResult)).toBe(true);
  const after = await page.evaluate(() => Economy.snapshot());
  expect(after.inventory.RX_78_2).toBe(1);
  expect(after.money).toBe(before.money - plan.money);
  expect(after.inventory.Type61).toBe(plan.items[0].quantity);
  await page.evaluate(entries => { Formation.replenish([...entries, entries[0]], "PMC"); }, entries);
  await expect(page.locator("#gameDialogTitle")).toHaveText("尚未开发，无法生产");
  await expect(page.locator("#gameDialog")).toContainText("RX-78");
  expect(await page.evaluate(() => Economy.snapshot())).toEqual(after);
});
for (const width of [1440, 390]) test(`preview layering, sale confirmation and shared production at ${width}px`, async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width, height: 960 });
  await load(page);
  await page.locator("#shellHangar").click();
  const actionLayout = await page.locator(".formation-unit-actions").evaluate(row => {
    const add = row.querySelector("#openFormationPicker"), produce = row.querySelector("#produceMissingFormation");
    produce.hidden = false;
    return [add.getBoundingClientRect().toJSON(), produce.getBoundingClientRect().toJSON()];
  });
  expect(Math.abs(actionLayout[0].width - actionLayout[1].width)).toBeLessThan(1);
  expect(actionLayout[0].top).toBe(actionLayout[1].top);
  await page.evaluate(() => Formation.previewUnit("Type61"));
  await expect(page.locator("#formationUnitDetail")).toBeVisible();
  await page.locator("#producePreviewUnit").scrollIntoViewIfNeeded();
  const preview = await page.locator("#producePreviewUnit").evaluate(button => {
    const r = button.getBoundingClientRect();
    return { reachable: button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)), background: getComputedStyle(document.querySelector("#formationUnitDetail .unit-detail-heading")).backgroundColor };
  });
  expect(preview.reachable).toBe(true);
  expect(preview.background).toBe("rgb(27, 34, 46)");
  const priceRow = await page.locator(".inventory-production-price").evaluate(row => [...row.children].map(child => child.getBoundingClientRect().toJSON()));
  expect(Math.max(...priceRow.map(r => r.top)) - Math.min(...priceRow.map(r => r.top))).toBeLessThan(6);
  const before = await page.evaluate(() => Economy.snapshot());
  await page.locator("#sellPreviewUnit").click();
  await expect(page.locator("#gameDialog")).toBeVisible();
  const refund = await page.evaluate(() => Economy.sellPrice("Type61"));
  await expect(page.locator("#gameDialog")).toContainText("+" + refund.money.toLocaleString("en-US"));
  await page.getByRole("button", { name: "取消", exact: true }).click();
  expect(await page.evaluate(() => Economy.snapshot())).toEqual(before);
  await page.locator("#sellPreviewUnit").click();
  await page.locator("#gameDialog").getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.locator(".inventory-owned")).toHaveText("持有 0 台");
  expect(refund.money % 50).toBe(0);
  expect(refund.supplies % 50).toBe(0);
  await page.locator("#producePreviewUnit").click();
  const expected = await page.evaluate(() => Economy.catalog.offers[Economy.baseModel("Type61")].quantity);
  await expect(page.locator(".inventory-owned")).toHaveText("持有 " + expected + " 台");
  await page.screenshot({ path: `.openai/preview-release-${width}.png` });
  expect(errors).toEqual([]);
});
test("host edits AI faction inline and chat input aligns with room information", async ({ page }) => {
  const app = createServer({ host: "127.0.0.1", port: 0 });
  const address = await app.listen(), base = `http://127.0.0.1:${address.port}`;
  const idle = () => page.waitForFunction(() => Net.active && Net.snapshot && !Net.awaiting);
  try {
    await page.goto(base);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => { I18n.setLanguage("zh"); document.getElementById("playerId").value = "TESTHOST"; });
    await page.evaluate(base => Lobby.reconnect(base), base);
    await expect(page.locator("#lobby")).toBeVisible();
    await page.locator("#createRoom").click();
    await expect(page.locator("#roomCode")).toHaveValue("TESTHOST的房间");
    await page.locator('#roomCreateForm button[type="submit"]').click();
    await idle();
    await page.locator("#addAI1").click();
    await idle();
    const faction = page.locator('[data-seat="1"] .lineup-faction select');
    await expect(faction).toBeEnabled();
    await faction.selectOption("EFSF");
    await page.waitForFunction(() => !Net.awaiting && Net.snapshot.members?.some(m => m.bot && m.characterFaction === "EFSF"));
    await expect(faction).toHaveValue("EFSF");
    const geometry = await page.evaluate(() => ({
      left: document.querySelector("#roomMain .room-controls").getBoundingClientRect().bottom,
      input: document.getElementById("roomChatForm").getBoundingClientRect().bottom,
      teams: [...document.querySelectorAll("#teamSlots > .team-slot")].map(e => ({ team: e.dataset.team, background: getComputedStyle(e).backgroundColor })),
    }));
    expect(Math.abs(geometry.left - geometry.input)).toBeLessThan(2);
    expect(geometry.teams.map(t => t.team)).toEqual(["0", "1"]);
    expect(geometry.teams.every(t => t.background === "rgb(37, 41, 48)")).toBe(true);
  } finally { await app.close(); }
});

for (const width of [1440, 1001, 390]) test(`technology branches fit vertically and faction accents differ at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 960 });
  await load(page);
  await page.locator("#shellHangar").click();
  const frames = await page.locator("#formationUnits .formation-icon").evaluateAll(nodes => nodes.map(frame => {
    const f = frame.getBoundingClientRect(), i = frame.querySelector("img").getBoundingClientRect();
    return i.left >= f.left + 1 && i.top >= f.top + 1 && i.right <= f.right - 1 && i.bottom <= f.bottom - 1;
  }));
  expect(frames.length).toBeGreaterThan(0);
  expect(frames.every(Boolean)).toBe(true);
  await page.locator("#shellDevelopment").click();
  const accents = [];
  for (const faction of ["EFSF", "ZEON"]) {
    await page.locator("#developmentFactionSelect").selectOption(faction);
    await expect(page.locator("#developmentMain")).toHaveAttribute("data-faction", faction);
    await page.waitForTimeout(100);
    const geometry = await page.evaluate(() => {
      const scroll = document.querySelector(".development-tree-scroll"), graph = document.getElementById("developmentTree");
      const selected = graph.querySelector('[aria-pressed="true"]');
      const action = document.querySelector("#developmentDetails > button"), price = document.querySelector(".development-research-price");
      return { scrollWidth: scroll.scrollWidth, width: scroll.clientWidth,
        graphRight: graph.getBoundingClientRect().right, right: scroll.getBoundingClientRect().right,
        actionBottom: action.getBoundingClientRect().bottom, priceTop: price.getBoundingClientRect().top,
        accent: getComputedStyle(selected).borderTopColor, overflowX: getComputedStyle(scroll).overflowX };
    });
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
    expect(geometry.graphRight).toBeLessThanOrEqual(geometry.right);
    expect(geometry.overflowX).toBe("hidden");
    expect(geometry.actionBottom).toBeLessThanOrEqual(geometry.priceTop);
    accents.push(geometry.accent);
  }
  expect(accents).toEqual(["rgb(122, 203, 255)", "rgb(255, 140, 150)"]);
  await page.screenshot({ path: `.openai/technology-release-${width}.png` });
});
