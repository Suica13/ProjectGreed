const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

for (const html of ["client.html", "developer.html"]) {
  test(`${html} initializes records controls and creates an offline room`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve("public", html)).href);
    await expect(page.locator("#openSkirmish")).toBeEnabled();
    expect(await page.evaluate(() => typeof window.ReplayPlayer?.refresh)).toBe("function");
    await expect(page.locator("#matchRecordsDialog #downloadBattleLog")).toHaveCount(1);
    await page.locator("#openSkirmish").click();
    await page.locator("#createOfflineRoom").click();
    await expect(page.locator("#roomPreparation")).toBeVisible();
    await expect(page.locator("#roomPreparation")).toContainText("AI");
    expect(
      await page
        .locator("#roomOpenMatchRecords")
        .evaluate((button) => button.previousElementSibling.id),
    ).toBe("roomShowLog");
    await page.locator("#roomOpenMatchRecords").click();
    await expect(page.locator("#matchRecordsDialog")).toBeVisible();
    await expect(page.locator("#battleLogPerspective")).toBeVisible();
    await expect(page.locator("#battleLogPerspective option")).toHaveText([
      "队伍1",
      "队伍2",
      "上帝视角",
    ]);
    await expect(page.getByRole("button", { name: "保存记录", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "从此回合继续", exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("record buttons, perspective downloads and replay controls follow room and battle layout", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await page.evaluate(() => {
    const original = createRoomEngine;
    createRoomEngine = (options) => {
      window.testRoomEngine = original({ ...options, roomReturnMs: 0 });
      return testRoomEngine;
    };
  });
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await page.locator("#startRoomGame").click();
  await page.locator("#confirmFinalFormation").click();
  await page.locator("#confirmDeployment").click();
  await expect.poll(() => page.evaluate(() => phase)).toBe("idle");
  expect(
    await page.locator("#openMatchRecords").evaluate((button) => button.nextElementSibling.id),
  ).toBe("netSettings");
  await page.evaluate(async () => {
    const room = testRoomEngine.rooms.get("OFFLINE");
    room.log = ["global-only"];
    room.teamLogs = { 0: ["team-one-only"], 1: ["team-two-only"] };
    room.lastEvent = { id: "test-log", type: "test" };
    await ReplayPlayer.request("replay_fork").catch(() => {});
    Net.request("sync");
  });
  await expect.poll(() => page.evaluate(() => Net.awaiting)).toBe(null);
  await page.locator("#openMatchRecords").click();
  await expect(page.locator('#battleLogPerspective option[value="team:1"]')).toBeDisabled();
  await expect(page.locator('#battleLogPerspective option[value="global"]')).toBeDisabled();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.evaluate(() => Net.request("return_room"));
  await expect(page.locator("#roomPreparation")).toBeVisible();
  await page.locator("#roomOpenMatchRecords").click();
  async function checkDownload(value, marker) {
    await page.locator("#battleLogPerspective").selectOption(value);
    const pending = page.waitForEvent("download");
    await page.locator("#downloadBattleLog").click();
    const download = await pending;
    const stream = await download.createReadStream();
    let text = "";
    for await (const chunk of stream) text += chunk.toString("utf8");
    expect(text).toContain(marker);
    const others = ["global-only", "team-one-only", "team-two-only"].filter(
      (other) => other !== marker,
    );
    for (const other of others) expect(text).not.toContain(other);
  }
  for (const [value, marker] of [
    ["team:0", "team-one-only"],
    ["team:1", "team-two-only"],
    ["global", "global-only"],
  ])
    await checkDownload(value, marker);
  await page.getByRole("button", { name: "回放本局", exact: true }).click();
  await expect(page.locator("#replayControls")).toBeVisible();
  await expect(page.getByRole("button", { name: "从此回合继续", exact: true })).toHaveCount(0);
  for (const size of ["collapsed", "normal", "expanded"]) {
    await page.evaluate((size) => (byId("gameScene").dataset.consoleSize = size), size);
    const geometry = await page.evaluate(() => ({
      parent: byId("replayControls").parentElement.id,
      bar: byId("replayControls").getBoundingClientRect().toJSON(),
      map: byId("mapWrap").getBoundingClientRect().toJSON(),
    }));
    expect(geometry.parent).toBe("mapWrap");
    expect(geometry.bar.bottom).toBeLessThanOrEqual(geometry.map.bottom);
    expect(geometry.bar.bottom).toBeGreaterThan(geometry.map.bottom - 20);
  }
  await page.locator("#openMatchRecords").click();
  for (const [value, marker] of [
    ["team:0", "team-one-only"],
    ["team:1", "team-two-only"],
    ["global", "global-only"],
  ])
    await checkDownload(value, marker);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.locator('#replayControls input[type="checkbox"]').check();
  await expect(page.locator("#replayControls")).toBeVisible();
  await expect(page.locator("#mapZoomIn")).toBeVisible();
  await expect(page.locator("#mapZoomOut")).toBeVisible();
  await expect(page.locator("#mapZoomReset")).toBeVisible();
  await expect(page.locator("#netSettings")).toBeHidden();
  const zoomBefore = await page.evaluate(() => MapCamera.zoom);
  await page.locator("#mapZoomIn").click();
  expect(await page.evaluate(() => MapCamera.zoom)).toBeGreaterThan(zoomBefore);
  const canvas = await page.locator("#map").boundingBox();
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  const zoomBeforeWheel = await page.evaluate(() => MapCamera.zoom);
  await page.mouse.wheel(0, -300);
  await expect.poll(() => page.evaluate(() => MapCamera.zoom)).toBeGreaterThan(zoomBeforeWheel);
  await page.evaluate(() => MapCamera.setZoom(3));
  const origin = await page.evaluate(() => ({ ox: mapGeo.ox, oy: mapGeo.oy }));
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width / 2 + 100, canvas.y + canvas.height / 2 + 70, {
    steps: 5,
  });
  await page.mouse.up();
  expect(await page.evaluate(() => ({ ox: mapGeo.ox, oy: mapGeo.oy }))).not.toEqual(origin);
  const timeline = page.locator('#replayControls input[type="range"]');
  const slider = await timeline.boundingBox();
  await page.mouse.click(slider.x + slider.width - 8, slider.y + slider.height / 2);
  await expect.poll(() => timeline.inputValue()).not.toBe("0");
  await page.keyboard.press("Escape");
  await expect(page.locator("#netSettings")).toBeVisible();
  expect(errors).toEqual([]);
});
