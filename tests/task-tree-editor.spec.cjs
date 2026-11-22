const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path"),
  fs = require("node:fs");
const url = pathToFileURL(path.resolve("public/task-tree-editor.html")).href;
test("offline task tree creates branches, edits dialogue and roundtrips exported design", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(url);
  await page.locator("#library button").filter({ hasText: "任务 / 阶段" }).click();
  await page.getByLabel("节点名称", { exact: true }).fill("联邦首秀");
  await page.getByLabel("节点名称", { exact: true }).press("Tab");
  await page.locator("#search").fill("对话演出");
  await page.locator("#library button").filter({ hasText: "对话演出" }).click();
  await page.getByLabel("角色名称", { exact: true }).fill("联邦联络人");
  await page.getByLabel("对话文本", { exact: true }).fill("开始行动。");
  await page.getByRole("button", { name: "＋ 添加对话", exact: true }).click();
  await expect(page.locator(".dialogue-line")).toHaveCount(2);
  await page.getByLabel("角色名称", { exact: true }).nth(1).fill("PMC");
  await page.getByLabel("对话文本", { exact: true }).nth(1).fill("收到。");
  await page.getByLabel("对话文本", { exact: true }).nth(1).press("Tab");
  const initial = await page.evaluate(() => TaskTreeEditor.snapshot());
  expect(initial.nodes[1].parameters.lines[0].text).toBe("开始行动。");
  expect(initial.nodes[1].parent).toBe(initial.nodes[0].id);
  await page.locator("#undo").click();
  await page.locator("#redo").click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export").click();
  const file = await downloadPromise;
  const exported = JSON.parse(fs.readFileSync(await file.path(), "utf8"));
  expect(exported.reference.availableTypes.length).toBeGreaterThan(40);
  await page.locator("#new").click();
  await expect(page.locator(".node")).toHaveCount(0);
  await page
    .locator("#file")
    .setInputFiles({
      name: "tree.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(exported)),
    });
  await expect(page.locator(".node")).toHaveCount(2);
  expect((await page.evaluate(() => TaskTreeEditor.snapshot())).nodes).toEqual(initial.nodes);
  await page.locator("#preview").click();
  await expect(page.locator("#validation")).toContainText("设计结构有效");
  await page.locator("#close").click();
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.locator(".node")).toHaveCount(2);
  const aiDownload = page.waitForEvent("download");
  await page.locator("#ai").click();
  const ai = await aiDownload;
  expect(fs.readFileSync(await ai.path(), "utf8")).toContain("MissionMode.validate");
  expect(errors).toEqual([]);
  await page.screenshot({
    path: "tmp/verification/screenshots/task-tree-editor-desktop.png",
    fullPage: true,
  });
});
test("mobile editor imports native map and displays event descriptions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  page.on("dialog", (d) => d.accept());
  await page.goto(url);
  await page.locator("#file").setInputFiles("assets/maps/missions/white_base.json");
  await expect(page.locator(".node").first()).toBeVisible();
  expect(
    await page.evaluate(() => TaskTreeEditor.snapshot().sourceMap.mission.events.length),
  ).toBeGreaterThan(0);
  await page.locator("#search").fill("防守友军据点");
  const button = page.locator("#library button").filter({ hasText: "防守友军据点" });
  await expect(button).toHaveAttribute("title", /友军自动防守/);
  await button.click();
  await expect(page.locator("#inspector .description")).toContainText("PMC靠近");
  await page.screenshot({
    path: "tmp/verification/screenshots/task-tree-editor-mobile.png",
    fullPage: true,
  });
});
