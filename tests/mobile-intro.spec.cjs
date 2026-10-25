const { test } = require("@playwright/test"),
  assert = require("node:assert/strict"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
const url = pathToFileURL(path.resolve("public/client.html")).href;
test("mobile startup recommends landscape before revealing the main menu without locking orientation", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  assert.equal(await page.evaluate(() => byId("mobileLandscapeTip").hidden), false);
  assert.equal(await page.evaluate(() => getComputedStyle(byId("start")).visibility), "hidden");
  assert.ok((await page.evaluate(() => byId("mobileLandscapeTitle").textContent)).includes("横屏"));
  await page.screenshot({ path: ".openai/mobile-landscape-tip.png" });
  await page.evaluate(() => byId("continueFromLandscapeTip").click());
  assert.deepEqual(
    await page.evaluate(() => [
      byId("mobileLandscapeTip").hidden,
      getComputedStyle(byId("start")).visibility,
      pageView,
      innerWidth < innerHeight,
    ]),
    [true, "visible", "menu", true],
  );
  await page.evaluate(async () => {
    await SpriteRenderer.load();
    LocalRoom.open();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.equal(await page.evaluate(() => pageView), "room");
  assert.equal(await page.evaluate(() => byId("mobileLandscapeTip").hidden), true);
  await page.evaluate(() => Net.leave());
  assert.equal(await page.evaluate(() => byId("mobileLandscapeTip").hidden), true);
  assert.deepEqual(errors, []);
});
test("landscape phones see the same startup tip once and preserve their orientation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(url);
  assert.equal(await page.evaluate(() => byId("mobileLandscapeTip").hidden), false);
  await page.evaluate(() => byId("continueFromLandscapeTip").click());
  assert.deepEqual(
    await page.evaluate(() => [
      pageView,
      innerWidth > innerHeight,
      byId("mobileLandscapeTip").hidden,
    ]),
    ["menu", true, true],
  );
});
