const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const width of [1440, 390])
  test(`fleet hangar cards support loading, capacity and safe hull removal at ${width}px`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 950 });
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.evaluate(() => I18n.setLanguage("zh"));
    await page.locator("#shellHangar").click();
    await page.locator("#newFormation").click();
    const styleBounds = await page.locator("#formationEditorStyle").boundingBox();
    const budgetBounds = await page.locator("#formationBudget").boundingBox();
    expect(styleBounds.x + styleBounds.width).toBeLessThanOrEqual(budgetBounds.x);
    expect(Math.abs(styleBounds.y + styleBounds.height / 2 - budgetBounds.y - budgetBounds.height / 2)).toBeLessThan(25);
    await page.locator("#formationEditorStyle").selectOption("free");
    await page.locator("#openFormationPicker").click();
    await expect(page.locator("#formationPickerTitle")).toHaveText("添加单位");
    await expect(page.locator('[data-unit-id="Type61"]')).toHaveCount(1);
    await page.locator("#closeFormationPicker").click();
    await page.locator("#formationEditorStyle").selectOption("standard");
    await expect(page.locator("#formationUnits")).toContainText("请先选择战舰或运输机");
    await page.locator("#openFormationPicker").click();
    await expect(page.locator("#formationPickerTitle")).toHaveText("选择战舰或运输机");
    await expect(page.locator('[data-unit-id="Type61"]')).toHaveCount(0);
    await page.locator('[data-unit-id="Medea"] strong').first().click();
    await page.locator("#addFormationUnit").click();
    await page.locator("#closeFormationPicker").click();
    const group = page.locator('[data-fleet-carrier="0"]');
    const count = await page.evaluate(
      () => Rules.formationModel(Formation.current()[0]).hangars.length,
    );
    await expect(group.locator(".formation-hangar-card")).toHaveCount(count);
    const empty = group.locator(".formation-empty-slot").first();
    await expect(empty.locator(".formation-empty-portrait")).toHaveText("＋");
    await empty.click();
    await page.locator('[data-unit-id="Type61"] strong').first().click();
    await page.locator("#addFormationUnit").click();
    await expect(page.locator("#formationUnitPicker")).toBeVisible();
    await expect(page.locator("#formationUnitDetail")).toBeHidden();
    await page.locator("#addFormationUnit").click();
    expect(await page.evaluate(() => Formation.current().length)).toBe(3);
    await page.locator("#closeFormationPicker").click();
    await expect(group.locator(".formation-preloaded-row")).toHaveCount(2);
    await expect(group.locator(".formation-hangar-title").first()).toContainText("2 /");
    expect(await page.evaluate(() => Formation.current()[1].preload.carrierIndex)).toBe(0);
    await group.locator(".formation-empty-slot").first().click();
    await page.locator('[data-unit-id="Type61"] strong').first().click();
    const capacity = await page.evaluate(() => Rules.formationModel(Formation.current()[0]).hangars[0].capacity);
    for (let used = 2; used < capacity; used++) {
      await page.locator("#addFormationUnit").click();
      await expect(page.locator("#formationUnitPicker")).toBeVisible();
    }
    await expect(page.locator("#formationCatalog")).toContainText("格纳库已满");
    await expect(page.locator("#addFormationUnit")).toBeDisabled();
    expect(await page.evaluate(() => Formation.current().length)).toBe(capacity + 1);
    await page.locator("#closeFormationPicker").click();
    const bounds = await group.boundingBox();
    expect(bounds.width).toBeLessThan(width);
    for (const card of await group.locator(".formation-row").all()) {
      const box = await card.boundingBox();
      expect(box.height).toBe(116);
      const actions = await card.locator(".formation-row-actions").boundingBox();
      expect(actions.x + actions.width).toBeLessThanOrEqual(box.x + box.width + 1);
      for (const button of await card.locator(".formation-row-actions > button:visible").all()) {
        const b = await button.boundingBox();
        expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 1);
      }
    }
    await page.screenshot({ path: `tmp/verification/screenshots/formation-fleet-${width}.png` });
    await group
      .locator('[data-formation-index="0"]')
      .getByRole("button", { name: "移除", exact: true })
      .click();
    await expect(page.locator(".formation-unassigned")).toContainText("61式");
    expect(await page.evaluate(() => Formation.current()[0].preload)).toBeUndefined();
    await page.reload();
    await page.locator("#shellHangar").click();
    await expect(page.locator(".formation-unassigned")).toContainText("61式");
    expect(errors).toEqual([]);
  });
