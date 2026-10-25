const { test } = require("@playwright/test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

test("AI can copy a local formation preset, preserve it across settings changes and deploy it offline", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const units = Array.from({ length: 8 }, (_, i) => ({
    unitId: "RGM_79",
    kitId: i % 2 ? "bazooka" : "machine_gun",
    customName: "本地吉姆" + (i + 1),
  }));
  await page.addInitScript((units) => {
    localStorage.setItem(
      "slg-formations-v1",
      JSON.stringify([
        { name: "我的测试预设", units },
        { name: "第二预设", units: units.slice(0, 2) },
      ]),
    );
  }, units);
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.evaluate(async () => {
    await SpriteRenderer.load();
    I18n.setLanguage("zh");
    LocalRoom.open();
    await new Promise((r) => setTimeout(r, 0));
  });
  await page.locator("#aiSettings1").click();
  const options = await page.locator("#ai-formation-1 option").allTextContents();
  assert.deepEqual(options, ["随机编组", "我的测试预设", "第二预设"]);
  await page.locator("#ai-formation-1").selectOption("0");
  assert.deepEqual(
    await page.evaluate(() => Net.snapshot.members.find((m) => m.bot).formationPreset),
    { name: "我的测试预设", units },
  );
  await page.locator("#ai-difficulty-1").selectOption("125");
  assert.equal(
    await page.evaluate(() => Net.snapshot.members.find((m) => m.bot).formationPreset.name),
    "我的测试预设",
  );
  assert.equal(await page.locator("#ai-formation-1").inputValue(), "0");
  await page.locator("#ai-formation-1").selectOption("random");
  assert.equal(
    await page.evaluate(() => Net.snapshot.members.find((m) => m.bot).formationPreset),
    null,
  );
  await page.locator("#ai-formation-1").selectOption("0");
  await page.evaluate(() => {
    byId("closeRoomDetail").click();
  });
  await page.evaluate(async () => {
    Net.request("start_game", { formation: Formation.current().slice(0, 6) });
    await new Promise((r) => setTimeout(r, 0));
    byId("confirmFinalFormation").click();
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(await page.evaluate(() => phase), "deployment");
  assert.deepEqual(
    await page.evaluate(() =>
      game.units
        .filter((u) => u.ownerSeat === 1)
        .map((u) => ({ name: u.customName, model: u.model })),
    ),
    units.map((u) => ({ name: u.customName, model: u.unitId + "__" + u.kitId })),
  );
  assert.deepEqual(await page.evaluate(() => Formation.presets()[0].units), units);
  assert.deepEqual(errors, []);
});
