const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
async function open(page) {
  page.on("dialog", () => {
    throw Error("Unexpected browser dialog");
  });
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(() => I18n.setLanguage("zh"));
}
for (const width of [1280, 360])
  test(`shared dialog cancellation, focus, safe text and queued choices at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await open(page);
    await page.locator("#openFormation").focus();
    await page.evaluate(() => {
      window.dialogResults = [];
      GameDialog.confirm("<img src=x onerror=alert(1)>\n取消不会执行操作", {
        title: "确认操作",
        danger: true,
      }).then((v) => dialogResults.push(v));
      GameDialog.alert("第二条提示").then(() => dialogResults.push("done"));
    });
    const dialog = page.locator("#gameDialog");
    await expect(dialog).toContainText("<img src=x onerror=alert(1)>");
    await expect(dialog.locator("img")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeFocused();
    const box = await dialog.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await expect(dialog).toContainText("第二条提示");
    await dialog.getByRole("button", { name: "确认", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(await page.evaluate(() => dialogResults)).toEqual([false, "done"]);
    await expect(page.locator("#openFormation")).toBeFocused();
  });
test("text entry validates, returns its value and cancels on page changes", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    window.inputResult = "pending";
    GameDialog.prompt("输入名称", { required: true, maxLength: 12 }).then(
      (v) => (window.inputResult = v),
    );
  });
  const input = page.locator("#gameDialogInput");
  await expect(input).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => inputResult)).toBe("pending");
  await input.fill("新名称");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => inputResult)).toBe("新名称");
  await page.evaluate(() => {
    window.cancelResults = {};
    GameDialog.prompt("正在输入").then((v) => (cancelResults.input = v));
    GameDialog.confirm("排队中的确认").then((v) => (cancelResults.confirm = v));
    window.dispatchEvent(new Event("page-changing"));
  });
  await expect(page.locator("#gameDialog")).not.toBeVisible();
  expect(await page.evaluate(() => cancelResults)).toEqual({ input: null, confirm: false });
});
