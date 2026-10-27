const { test, expect } = require("@playwright/test"),
  { createServer } = require("../server.js");
for (const width of [1280, 390])
  test(`developer unlock rows add, replace, remove and save independently at ${width}px`, async ({
    page,
  }) => {
    const app = createServer({ host: "127.0.0.1", port: 0 }),
      address = await app.listen();
    let saved;
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/developer/tree", async (route) => {
      if (route.request().method() === "POST") {
        saved = route.request().postDataJSON();
        await route.fulfill({ json: { ok: true } });
      } else await route.continue();
    });
    try {
      await page.goto(`http://127.0.0.1:${address.port}/developer.html`);
      await page.waitForFunction(() => assetsReady);
      await page.evaluate(() => I18n.setLanguage("zh"));
      await page.locator("#openDevelopment").click();
      await page.locator("#developerTreeEdit").click();
      await expect(page.locator("#developerTreeFields")).toBeVisible();
      const selector = page.locator(".source-unlock-row select"),
        initial = await selector.evaluateAll((selects) => selects.map((select) => select.value));
      const choices = await page.evaluate(
        (initial) =>
          Rules.catalog.prefabs
            .map((unit) => unit.id)
            .filter((id) => !initial.includes(id))
            .slice(0, 2),
        initial,
      );
      await expect(page.locator("#developerTreeFields select[multiple]")).toHaveCount(0);
      await page.locator("#developerAddUnlock").click();
      await selector.nth(initial.length).selectOption(choices[0]);
      await page.locator("#developerAddUnlock").click();
      await selector.nth(initial.length + 1).selectOption(choices[1]);
      await expect(
        selector.nth(initial.length).locator(`option[value="${choices[1]}"]`),
      ).toBeDisabled();
      await page.locator(".source-unlock-row").nth(initial.length).locator("button").click();
      expect(
        await selector.evaluateAll((selects) => selects.map((select) => select.value)),
      ).toEqual([...initial, choices[1]]);
      const nodeId = await page.locator("#developerTechSelect").inputValue();
      await page.locator("#developerTreeEdit").click();
      await expect(page.locator("#developerTreeEdit")).toHaveText("修改属性");
      expect(
        Object.values(saved.data)
          .flat()
          .find((node) => node.id === nodeId).unlocks,
      ).toEqual([...initial, choices[1]]);
      expect(errors).toEqual([]);
    } finally {
      await app.close();
    }
  });
