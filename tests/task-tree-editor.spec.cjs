const { test, expect } = require("@playwright/test"),
  path = require("node:path"),
  fs = require("node:fs"),
  { pathToFileURL } = require("node:url");
const url = pathToFileURL(path.resolve("admin/task-tree-editor.html")).href;
test("single-contact export includes the portrait and preserves it through import and upload", async ({ page }) => {
  page.on("dialog", d => d.accept());
  await page.goto(url);
  await page.locator("#file").setInputFiles("docs/data/contacts/efsf-1.0.json");
  await expect(page.locator(".node")).toHaveCount(6);
  await page.locator("#contactText").click();
  const image = page.locator(".contact-portrait");
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  await page.getByLabel("联络人头像", { exact:true }).setInputFiles("assets/pilots/Pilot_EFSF_0079_Common_2.png");
  await expect.poll(() => page.evaluate(() => TaskTreeEditor.snapshot().contacts[0].portrait.source)).toBe("Pilot_EFSF_0079_Common_2.png");
  await page.locator("#addContact").click();
  const secondId = await page.locator("#contact").inputValue();
  await page.locator("#addTask").click();
  await page.locator("#contact").selectOption("efsf");
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export").click();
  const download = await downloadPromise;
  const output = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  expect(download.suggestedFilename()).toContain("efsf-");
  expect(output.contacts).toHaveLength(1);
  expect(output.contacts[0].tasks).toHaveLength(6);
  expect(output.contacts[0].portrait.dataUrl).toBe("data:image/png;base64," + fs.readFileSync("assets/pilots/Pilot_EFSF_0079_Common_2.png").toString("base64"));
  await page.locator("#contact").selectOption(secondId);
  expect((await page.evaluate(() => TaskTreeEditor.exportValue())).contacts[0].tasks).toHaveLength(1);
  await page.locator("#file").setInputFiles({name:"efsf.json", mimeType:"application/json", buffer:Buffer.from(JSON.stringify(output))});
  await page.locator("#contactText").click();
  await expect.poll(() => image.evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  await page.reload();
  expect((await page.evaluate(() => TaskTreeEditor.snapshot())).contacts).toEqual(output.contacts);
});
for (const width of [1440, 390])
  test(`planning-only liaison tree preserves version, markers and free text at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    const errors = [],
      network = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (/^https?:/.test(r.url())) network.push(r.url());
    });
    page.on("dialog", (d) => d.accept());
    await page.goto(url);
    await page.getByLabel("委托系统版本号", { exact: true }).fill("委托策划-2.3");
    await page.getByLabel("委托系统版本号", { exact: true }).press("Tab");
    await page.locator("#addTask").click();
    await page.getByLabel("委托名称", { exact: true }).fill("首秀");
    await page
      .getByLabel("策划文本", { exact: true })
      .fill("在N1以上击坠六架吉翁MS。\n奖励3000资金，吉姆初期型3台。");
    await page.getByLabel("策划文本", { exact: true }).press("Tab");
    await page.getByLabel("委托改动标记", { exact: true }).selectOption("有变动");
    await page.locator("#addTask").click();
    await expect(page.locator(".node")).toHaveCount(2);
    await page.getByLabel("委托名称", { exact: true }).fill("旧版搜索任务");
    await page.getByLabel("委托名称", { exact: true }).press("Tab");
    await page.getByLabel("委托改动标记", { exact: true }).selectOption("废弃");
    const promise = page.waitForEvent("download");
    await page.locator("#export").click();
    const file = await promise,
      output = JSON.parse(fs.readFileSync(await file.path(), "utf8"));
    expect(output.systemVersion).toBe("委托策划-2.3");
    expect(output.contacts[0].tasks[0].status).toBe("有变动");
    expect(output.contacts[0].tasks[1].status).toBe("废弃");
    expect(output.contacts[0].tasks[1].requires).toEqual(["task_1"]);
    await page.locator("#new").click();
    await page
      .locator("#file")
      .setInputFiles({
        name: "planning.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(output)),
      });
    await expect(page.locator(".node")).toHaveCount(2);
    await expect(page.locator("#systemVersion")).toHaveValue("委托策划-2.3");
    await page.waitForTimeout(300);
    await page.reload();
    expect((await page.evaluate(() => TaskTreeEditor.snapshot())).contacts).toEqual(
      output.contacts,
    );
    const aiPromise = page.waitForEvent("download");
    await page.locator("#ai").click();
    const ai = await aiPromise;
    expect(fs.readFileSync(await ai.path(), "utf8")).toContain("无需调整");
    await page.screenshot({
      path: `tmp/verification/screenshots/contact-planning-${width}.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
    expect(network).toEqual([]);
  });
