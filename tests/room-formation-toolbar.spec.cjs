const { test } = require("@playwright/test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

test("room formation dropdown sits beside start, switches the active army and warns without COST details", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    const gm = { unitId: "RGM_79", kitId: "machine_gun", customName: "预设吉姆" };
    localStorage.setItem(
      "slg-formations-v1",
      JSON.stringify([
        { name: "有效预设", units: [gm] },
        { name: "昂贵预设", units: [{ unitId: "RX_79_G", kitId: "beam_rifle" }] },
        { name: "超数量预设", units: Array(8).fill(gm) },
      ]),
    );
    localStorage.setItem("slg-formations-v1-active", "0");
  });
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.evaluate(async () => {
    await SpriteRenderer.load();
    I18n.setLanguage("zh");
    LocalRoom.open();
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.deepEqual(await page.locator("#roomFormationSelect option").allTextContents(), [
    "编组: 有效预设",
    "编组: 昂贵预设",
    "编组: 超数量预设",
  ]);
  const layout = await page.evaluate(() => ({
    start: byId("startRoomGame").getBoundingClientRect().toJSON(),
    select: byId("roomFormationSelect").getBoundingClientRect().toJSON(),
    edit: byId("roomFormation").getBoundingClientRect().toJSON(),
    framed:
      byId("roomMapInfo").parentElement.classList.contains("room-map-panel") &&
      byId("roomMapInfo").parentElement.contains(byId("roomMapPreview")),
    underMap: !!byId("roomFormation").closest(".room-controls"),
    text: document.querySelector(".room-formation-controls").textContent,
  }));
  assert.ok(layout.select.left >= layout.start.right);
  assert.ok(layout.edit.left >= layout.select.right);
  assert.ok(Math.abs(layout.select.top - layout.start.top) < 3);
  assert.ok(layout.framed);
  assert.equal(layout.underMap, false);
  assert.ok(!layout.text.includes("COST"));
  await page.evaluate(async () => {
    Net.request("set_ready", { ready: true, formation: Formation.current() });
    await new Promise((r) => setTimeout(r, 0));
  });
  await page.locator("#roomFormationSelect").selectOption("1");
  assert.equal(await page.locator("#roomFormationWarning").textContent(), "不符合编组规则");
  assert.equal(await page.locator("#roomFormationSelect").getAttribute("aria-invalid"), "true");
  assert.ok(await page.locator("#startRoomGame").isDisabled());
  assert.equal(
    await page.evaluate(() => Net.snapshot.members.find((m) => m.id === Net.memberId).ready),
    true,
  );
  await page.locator("#roomFormationSelect").selectOption("2");
  assert.equal(await page.locator("#roomFormationWarning").textContent(), "不符合编组规则");
  assert.equal(await page.evaluate(() => Formation.current().length), 8);
  await page.locator("#roomFormationSelect").selectOption("0");
  assert.ok(await page.locator("#roomFormationWarning").isHidden());
  assert.equal(await page.evaluate(() => Formation.name()), "有效预设");
  assert.ok(await page.locator("#startRoomGame").isEnabled());
  await page.screenshot({ path: ".openai/room-formation-toolbar.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.evaluate(() => ({
    right: document.querySelector(".room-formation-controls").getBoundingClientRect().right,
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert.ok(mobile.right <= mobile.width);
  assert.ok(mobile.scroll <= mobile.width);
  await page.locator("#roomFormation").click();
  assert.equal(await page.locator("#formationName").inputValue(), "有效预设");
  assert.deepEqual(errors, []);
});
