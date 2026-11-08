const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1600, height: 1000 },
])
  test(`ACE recruitment list and details scroll independently at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => {
      for (const pilot of PilotSystem.catalog.aces) Development.grantUnit(pilot.faction, pilot.id);
      Formation.openAceRecruitment();
    });
    const dialog = page.locator("#aceRecruitDialog"),
      list = page.locator("#aceRecruitList");
    await expect(dialog).toBeVisible();
    const initial = await dialog.evaluate((el) => {
      const list = byId("aceRecruitList"),
        preview = byId("aceRecruitPreview");
      const rect = (node) => node.getBoundingClientRect().toJSON();
      return {
        dialog: rect(el),
        list: rect(list),
        preview: rect(preview),
        footer: rect(el.querySelector("footer")),
        count: list.children.length,
        scrollHeight: list.scrollHeight,
        clientHeight: list.clientHeight,
        fullCards: [...list.children].filter(
          (child) => child.getBoundingClientRect().bottom <= list.getBoundingClientRect().bottom,
        ).length,
      };
    });
    expect(initial.count).toBeGreaterThan(5);
    expect(initial.scrollHeight).toBeGreaterThan(initial.clientHeight);
    expect(initial.dialog.top).toBeGreaterThanOrEqual(0);
    expect(initial.dialog.bottom).toBeLessThanOrEqual(viewport.height + 1);
    expect(initial.preview.bottom).toBeLessThanOrEqual(initial.footer.top + 1);
    if (viewport.width <= 600) {
      expect(initial.list.bottom).toBeLessThanOrEqual(initial.preview.top);
      if (viewport.height >= 800) expect(initial.fullCards).toBeGreaterThanOrEqual(2);
    }
    const last = page.locator("#aceRecruitList > button").last();
    const id = await last.getAttribute("data-ace-id");
    await list.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await last.click();
    await expect(last).toHaveAttribute("aria-pressed", "true");
    expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    const name = await page.evaluate((id) => I18n.localized(PilotSystem.aceProfile(id)), id);
    await expect(page.locator("#aceRecruitPreview")).toContainText(name);
    await page.locator("#aceRecruitPreview").evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(page.locator("#confirmRecruitAce")).toBeVisible();
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(errors).toEqual([]);
  });
