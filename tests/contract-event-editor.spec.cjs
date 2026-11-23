const { test, expect } = require("@playwright/test"),
  fs = require("node:fs"),
  path = require("node:path");
const { pathToFileURL } = require("node:url");
const url = pathToFileURL(path.resolve("admin/contract-event-editor.html")).href;
for (const width of [1440, 390])
  test(`contract planning editor round trip and layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 980 });
    const errors = [],
      requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (req) => {
      if (req.url() !== url) requests.push(req.url());
    });
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto(url);
    await expect(page.locator(".event-item")).toHaveCount(14);
    await page.locator("#systemVersion").fill("2.1");
    await page.locator("#status").selectOption("有变动");
    await page.getByRole("tab", { name: "触发与判定" }).click();
    await page.locator("#field_trigger").fill("靠近两格启动\n第二行保留");
    await page.getByRole("tab", { name: "改动与参考" }).click();
    await page.locator("#field_notes").fill("<img src=x onerror=alert(1)>\n请按此版本实施。");
    await page.locator("#preview").click();
    await expect(page.locator("#previewText")).toContainText("靠近两格启动");
    await expect(page.locator("#previewText img")).toHaveCount(0);
    await page.locator("#previewDialog [data-close]").click();
    const promise = page.waitForEvent("download");
    await page.locator("#export").click();
    const download = await promise;
    const raw = fs.readFileSync(await download.path(), "utf8"),
      exported = JSON.parse(raw);
    expect(exported.events).toHaveLength(14);
    expect(exported.events[0].status).toBe("有变动");
    expect(download.suggestedFilename()).toBe("contract-events-2.1.json");
    await page
      .locator("#file")
      .setInputFiles({
        name: "roundtrip.json",
        mimeType: "application/json",
        buffer: Buffer.from(raw),
      });
    expect(await page.evaluate(() => ContractEventEditor.snapshot())).toEqual(exported);
    await page
      .locator("#file")
      .setInputFiles({
        name: "wrong.json",
        mimeType: "application/json",
        buffer: Buffer.from('{"format":"wrong"}'),
      });
    await expect(page.locator("#message")).toHaveClass("error");
    expect(await page.evaluate(() => ContractEventEditor.snapshot())).toEqual(exported);
    await page.locator("#group").selectOption("联络委托变体");
    await expect(page.locator(".event-item")).toHaveCount(7);
    await page.locator("#add").click();
    await page.locator("#template").selectOption("capture");
    await page.locator("#confirmAdd").click();
    await expect(page.locator(".event-item")).toHaveCount(15);
    await expect(page.locator("#status")).toHaveValue("需要调整");
    await expect(page.locator("#type")).toHaveValue("capture");
    expect(
      (await page.evaluate(() => ContractEventEditor.snapshot())).events.at(-1).completion,
    ).toContain("五个完整");
    await page.locator("#type").selectOption("custom");
    await page.locator("#customType").fill("escort");
    await page.locator("#customType").press("Tab");
    await expect(page.locator("#typeHint")).toContainText("新增类型目前未实现");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `tmp/verification/screenshots/contract-editor-${width}.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
  });

test("single-event export preserves shared rules without marking other changes saved", async ({
  page,
}) => {
  await page.goto(url);
  await page.locator("#name").fill("回收修改");
  const promise = page.waitForEvent("download");
  await page.locator("#exportCurrent").click();
  const download = await promise,
    value = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  expect(value.events).toHaveLength(1);
  expect(value.events[0].name).toBe("回收修改");
  expect(value.commonRules).toContain("存活上限");
  await expect(page.locator("#saveState")).toContainText("有改动");
});
