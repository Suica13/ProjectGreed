const { test: base, expect } = require("@playwright/test");
const { createServer } = require("../server.js");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// 每个测试进程使用操作系统分配的空闲端口，不占用用户正在运行的服务器。
const test = base.extend({
  serverURL: [
    async ({}, use) => {
      const app = createServer({ host: "127.0.0.1", port: 0 });
      const address = await app.listen();
      try {
        await use("http://127.0.0.1:" + address.port);
      } finally {
        await app.close();
      }
    },
    { scope: "worker" },
  ],
  baseURL: async ({ serverURL }, use) => {
    await use(serverURL);
  },
});

async function openEditor(page) {
  await page.goto("/developer.html");
  await expect(page.locator("#loading")).toContainText("已就绪");
  await page.locator("#ui-dev-launch").click();
  await page.waitForFunction(
    () => document.getElementById("ui-preview-frame").contentWindow.GamePreview?.ready,
  );
  return page.frameLocator("#ui-preview-frame");
}
async function preview(page, callback) {
  return page
    .locator("#ui-preview-frame")
    .evaluate((frame, source) => frame.contentWindow.eval(`(${source})()`), callback.toString());
}
async function numberField(page, id, value) {
  const input = page.locator(id);
  await input.fill(String(value));
  await input.dispatchEvent("change");
}

test("all scenes preview independently; canvas dragging, resizing, history and responsive profiles", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const frame = await openEditor(page);
  const original = await page.evaluate(() => JSON.stringify({ game, phase, selected, battleView }));
  for (const scene of ["start", "map", "reaction", "battle", "help", "victory"]) {
    await page.locator("#uie-scene").selectOption(scene);
    if (scene !== "map") await expect(frame.locator("#" + scene)).toBeVisible();
    await expect(page.locator("#uie-target option")).not.toHaveCount(0);
  }
  await page.locator("#uie-left-actor").click();
  await expect.poll(() => preview(page, () => GamePreview.boxes.length)).toBe(2);
  // 使用参考框中心拖动机体。先缩小以便左右包围框不会重叠。
  await page.locator("summary").filter({ hasText: "战斗与地图画布参数" }).click();
  await numberField(page, "#uie-b-scale", 0.45);
  await expect.poll(() => preview(page, () => UILayout.battle().scale)).toBe(0.45);
  const actor = await page.locator("#ui-selection").boundingBox();
  await page.mouse.move(actor.x + actor.width / 2, actor.y + actor.height / 2);
  await page.mouse.down();
  await page.mouse.move(actor.x + actor.width / 2 + 50, actor.y + actor.height / 2 + 20, {
    steps: 4,
  });
  await page.mouse.up();
  await expect.poll(() => preview(page, () => UILayout.battle().leftX)).toBeGreaterThan(0.25);
  const moved = await preview(page, () => UILayout.battle().leftX);
  await page.locator("#uie-undo").click();
  expect(await preview(page, () => UILayout.battle().leftX ?? 0.25)).toBe(0.25);
  await page.locator("#uie-redo").click();
  expect(await preview(page, () => UILayout.battle().leftX)).toBe(moved);
  const handle = await page.locator("#ui-resize").boundingBox();
  await page.mouse.move(handle.x + 8, handle.y + 8);
  await page.mouse.down();
  await page.mouse.move(handle.x + 40, handle.y + 40, { steps: 4 });
  await page.mouse.up();
  expect(await preview(page, () => UILayout.battle().leftScale)).toBeGreaterThan(1);
  await page.locator("#uie-size").selectOption("390,844");
  await expect.poll(() => preview(page, () => UILayout.profile())).toBe("mobile");
  await numberField(page, "#uie-b-scale", 0.6);
  expect(await preview(page, () => UILayout.battle().scale)).toBe(0.6);
  await page.locator("#uie-size").selectOption("1440,900");
  await expect.poll(() => preview(page, () => UILayout.battle().scale)).toBe(0.45);
  expect(await page.evaluate(() => JSON.stringify({ game, phase, selected, battleView }))).toBe(
    original,
  );
  await page.locator("#uie-close").click();
  expect(await preview(page, () => GamePreview.suspended)).toBe(true);
  await page.locator("#ui-dev-launch").click();
  await page.locator("#uie-replay").click();
  await expect.poll(() => preview(page, () => GamePreview.progress)).toBeGreaterThan(0.01);
  expect(errors).toEqual([]);
});

test("model, weapon, timeline and results render without playing a match", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const frame = await openEditor(page);
  await page.locator("#uie-scene").selectOption("battle");
  for (const model of ["RX_78_2", "RX_77_2", "RX_75"]) {
    await page.locator("#uie-left").selectOption(model);
    const weapons = await page
      .locator("#uie-weapon option")
      .evaluateAll((items) => items.map((item) => item.value));
    for (const weapon of weapons) {
      await page.locator("#uie-weapon").selectOption(weapon);
      await page.locator("#uie-progress").fill("0.15");
      await expect.poll(() => preview(page, () => GamePreview.boxes[0]?.unit.model)).toBe(model);
    }
  }
  await page.locator("#uie-result").selectOption("miss");
  await page.locator("#uie-response").selectOption("defend");
  await page.locator("#uie-progress").fill("0.7");
  await expect.poll(() => preview(page, () => GamePreview.events[0].hit)).toBe(false);
  await page.locator("#uie-result").selectOption("kill");
  await page.locator("#uie-progress").fill("1");
  await expect.poll(() => preview(page, () => GamePreview.events[0].after)).toBe(0);
  await expect(frame.locator("#battleInfo")).toContainText("HP 0 /");
  await page.locator("#uie-replay").click();
  await expect.poll(() => preview(page, () => GamePreview.progress)).toBeGreaterThan(0);
  await page.locator("#uie-play").click();
  expect(await preview(page, () => GamePreview.playing)).toBe(false);
  expect(errors).toEqual([]);
});

test("DOM properties, parent anchors, import, persistence and release export", async ({
  page,
  context,
}) => {
  const frame = await openEditor(page);
  await page.locator("#uie-scene").selectOption("battle");
  await page.locator("#uie-target").selectOption("battleCaption");
  await numberField(page, "#uie-fontSize", 28);
  await expect(frame.locator("#battleCaption")).toHaveCSS("font-size", "28px");
  await page.locator("#uie-anchor").selectOption("parent-top-left");
  await numberField(page, "#uie-x", 15);
  await expect(frame.locator("#battleCaption")).toHaveCSS("position", "absolute");
  await expect(frame.locator("#battleCaption").locator("..")).toHaveCSS("position", "relative");
  await page.locator("#uie-hidden").check();
  await expect(frame.locator("#battleCaption")).toHaveCSS("visibility", "hidden");
  await page.locator("#uie-hidden").uncheck();
  const layoutPromise = page.waitForEvent("download");
  await page.locator("#uie-export").click();
  const download = await layoutPromise;
  const json = await fs.readFile(await download.path(), "utf8");
  expect(JSON.parse(json).profiles.desktop.battleCaption.fontSize).toBe(28);
  await page.locator("#uie-reset").click();
  await page.locator("#uie-file").setInputFiles({
    name: "layout.json",
    mimeType: "application/json",
    buffer: Buffer.from(json),
  });
  await expect(frame.locator("#battleCaption")).toHaveCSS("font-size", "28px");
  const exportPromise = page.waitForEvent("download");
  await page.locator("#uie-publish").click();
  const exported = await exportPromise;
  const html = await fs.readFile(await exported.path(), "utf8");
  expect(html).not.toMatch(
    /ui-editor-panel|ui-preview-source|GamePreview\.configure|slg-ui-layout-dev-v1/,
  );
  const release = await context.newPage();
  const errors = [];
  release.on("pageerror", (e) => errors.push(e.message));
  const exportedPath = path.resolve(".openai/exported-release.html");
  await exported.saveAs(exportedPath);
  await release.goto(pathToFileURL(exportedPath).href);
  await expect(release.locator("#loading")).toContainText("已就绪");
  expect(await release.evaluate(() => UILayout.get().profiles.desktop.battleCaption.fontSize)).toBe(
    28,
  );
  await expect(release.locator("#ui-dev-launch")).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.reload();
  await page.locator("#ui-dev-launch").click();
  await page.waitForFunction(
    () => document.getElementById("ui-preview-frame").contentWindow.GamePreview?.ready,
  );
  expect(await preview(page, () => UILayout.get().profiles.desktop.battleCaption.fontSize)).toBe(
    28,
  );
});

test("release still starts an offline match and uses common battle drawing", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#loading")).toContainText("已就绪");
  await page.locator("#start details").evaluate((e) => (e.open = true));
  await page.locator("#startHotseat").click();
  await expect(page.locator("#start")).toBeHidden();
  await page.evaluate(() => {
    const left = game.units[0],
      right = game.units[3];
    right.x = left.x + 2;
    right.y = left.y;
    beginAttack(left, right, getWeapon(left, "br"));
  });
  await page.locator("#responseDefend").click();
  await page.locator("#confirmResponse").click();
  await expect(page.locator("#battle")).toBeVisible();
  await page.locator("#skipBattle").click();
  await page.locator("#continueBattle").click();
  await expect(page.locator("#battle")).toBeHidden();
  expect(errors).toEqual([]);
});

test("standalone developer HTML also opens the isolated editor", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve("public/developer.html")).href);
  await expect(page.locator("#loading")).toContainText("已就绪");
  await page.locator("#ui-dev-launch").click();
  await page.waitForFunction(
    () => document.getElementById("ui-preview-frame").contentWindow.GamePreview?.ready,
  );
  await page.locator("#uie-scene").selectOption("battle");
  await expect.poll(() => preview(page, () => GamePreview.boxes.length)).toBe(2);
  expect(errors).toEqual([]);
});

test("network snapshots keep updating the real match while the preview stays isolated", async ({
  page,
  context,
  baseURL,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/developer.html");
  await expect(page.locator("#loading")).toContainText("已就绪");
  await page.locator("#serverAddress").fill(baseURL);
  await page.locator("#roomCode").fill("EDITOR");
  await page.locator("#createRoom").click();
  await expect.poll(() => page.evaluate(() => phase)).toBe("waiting");
  const guest = await context.newPage();
  await guest.goto("/");
  await expect(guest.locator("#loading")).toContainText("已就绪");
  await guest.locator("#serverAddress").fill(baseURL);
  await guest.locator("#roomCode").fill("EDITOR");
  await guest.locator("#joinRoom").click();
  await expect.poll(() => page.evaluate(() => phase)).toBe("idle");
  await page.locator("#ui-dev-launch").click();
  await page.waitForFunction(
    () => document.getElementById("ui-preview-frame").contentWindow.GamePreview?.ready,
  );
  await page.locator("#uie-scene").selectOption("battle");
  await expect.poll(() => preview(page, () => GamePreview.boxes.length)).toBe(2);
  expect(await preview(page, () => Net.active)).toBe(false);
  const revision = await page.evaluate(() => Net.revision);
  await page.evaluate(() => Net.request("end_turn"));
  await expect.poll(() => guest.evaluate(() => game.team)).toBe(1);
  await guest.evaluate(() => Net.request("end_turn"));
  await expect.poll(() => page.evaluate(() => game.round)).toBe(2);
  expect(await page.evaluate(() => Net.revision)).toBeGreaterThan(revision);
  expect(await preview(page, () => GamePreview.scene)).toBe("battle");
  expect(await preview(page, () => game.round)).toBe(1);
  await page.locator("#uie-close").click();
  await expect(page.locator("#turnBadge")).toContainText("第2回合");
  expect(errors).toEqual([]);
});
