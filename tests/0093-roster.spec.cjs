const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

test("0093 stock grants expose units without permits and all new models render", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  const result = await page.evaluate(async () => {
    const ids = [
      "RGM_89",
      "AMS_119",
      "RGZ_91",
      "RGZ_91B",
      "MSN_03",
      "MSN_04",
      "RX_93",
      "RX_93_Test",
    ];
    Economy.creditActivity({
      id: "0093-browser-stock",
      matchId: "fixture",
      money: 0,
      supplies: 0,
      inventory: Object.fromEntries(ids.map((id) => [id, 2])),
    });
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 720;
    canvas.id = "roster0093";
    canvas.style.cssText =
      "position:fixed;inset:0;z-index:999999;background:#17212b;width:1200px;height:720px";
    document.body.append(canvas);
    const ctx = canvas.getContext("2d"),
      rows = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i],
        model = Economy.defaultModel(id),
        x = 150 + (i % 4) * 300,
        y = 130 + Math.floor(i / 4) * 350;
      const m = Rules.models[model],
        keys = SpriteRenderer.battleKeys({ units: [{ model }] });
      await SpriteRenderer.ensureAssets(keys);
      SpriteRenderer.draw(ctx, model, x, y, 0.85, 0, m.presentation.idle, 0.2, null, true);
      ctx.fillStyle = "white";
      ctx.font = "18px sans-serif";
      ctx.fillText(m.name, x - 100, y + 130);
      rows.push({
        id,
        visible: SpriteRenderer.visibleLayers(model).length,
        loaded: SpriteRenderer.visibleLayers(model).every((l) => !!SpriteRenderer.images[l.asset]),
        quantity: Economy.quantity(id),
        permit: Economy.hasLicense(id),
        offer: Economy.licenseOffer(id),
      });
    }
    return rows;
  });
  for (const row of result) {
    expect(row.visible, row.id).toBeGreaterThan(0);
    expect(row.loaded, row.id).toBe(true);
    expect(row.quantity).toBe(2);
    expect(row.permit).toBe(false);
    expect(row.offer).toBeNull();
  }
  await page
    .locator("#roster0093")
    .screenshot({ path: "tmp/verification/screenshots/0093-roster.png" });
  expect(errors).toEqual([]);
});

test("activity admin can filter 0093 units and grant inventory without a permit", async ({
  page,
}) => {
  const { createServer } = require("../server.js");
  const app = createServer({ host: "127.0.0.1", port: 0 });
  const address = await app.listen();
  try {
    await page.goto(`http://127.0.0.1:${address.port}/admin/activities.html`);
    await expect(page.locator("#activities button").first()).toBeVisible();
    await page.locator("#title").fill("0093 stock fixture");
    await page.locator("#addChassisStock").click();
    await page.locator("#rewardUnitEra").selectOption("0093T1");
    for (const id of [
      "RGM_89",
      "AMS_119",
      "RGZ_91",
      "RGZ_91B",
      "MSN_03",
      "MSN_04",
      "RX_93",
      "RX_93_Test",
    ])
      await expect(page.locator(`#rewardUnitList [data-unit-id="${id}"]`)).toBeVisible();
    await page.locator('#rewardUnitList [data-unit-id="MSN_04"]').click();
    await page.locator("#rewardChassisCount").fill("2");
    await page.locator("#confirmRewardConfig").click();
    await page.locator("#publish").click();
    await expect(page.locator("#status")).toContainText("活动已发布");
    const event = app.activities.adminSnapshot().activities.at(-1);
    expect(event.rewards.inventory).toEqual({ MSN_04: 2 });
    expect(event.rewards.licenses || {}).toEqual({});
  } finally {
    await app.close();
  }
});
