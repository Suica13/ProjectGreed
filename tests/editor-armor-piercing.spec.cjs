const { test, expect } = require("@playwright/test");
const fs = require("node:fs"),
  path = require("node:path");
const { editorFixture } = require("./catalog-editor-fixture.cjs");
const { createDeveloperServer } = require("../tools/developer-server.cjs");
test("developer edits AP damage and resistance, then reuses the validated catalog on refresh", async ({
  page,
}) => {
  const f = editorFixture();
  let app;
  try {
    for (const file of [
      "public/developer.html",
      "client/locales/en.json",
      "client/locales/ja.json",
    ]) {
      const target = path.join(f.root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.resolve(file), target);
    }
    app = createDeveloperServer({ root: f.root, port: 0, store: f.store });
    const address = await app.listen(),
      base = "http://127.0.0.1:" + address.port;
    await page.goto(base + "/developer.html");
    await page.locator("#editorServerAddress").fill(base);
    await page.locator("#editorAccessKey").fill("13450");
    await page.locator("#confirmEditorLogin").click();
    await expect(page.locator("#encyclopediaScreen")).toBeVisible();
    await page.locator("#encyclopediaSearch").fill("RX_78_2");
    await page.locator('[data-unit-id="RX_78_2"] button').click();
    await page.locator("#editUnitProperties").click();
    await page.locator('[data-source-weapon="EF_HypeBazooka"] > summary').click();
    await page.locator('[data-field="weapon.EF_HypeBazooka.damageComponents.shellAP"]').fill("500");
    await page.locator('[data-field="weapon.EF_HypeBazooka.armorPiercingIgnore"]').fill("0.75");
    const at = Date.now();
    await page.locator("#editUnitProperties").click();
    await expect(page.locator("#editUnitProperties")).toHaveText("修改属性");
    const saved = f.store.getUnit("RX_78_2").unit.weapons.EF_HypeBazooka;
    expect(saved.damageComponents.shellAP).toBe(500);
    expect(saved.armorPiercingIgnore).toBe(0.75);
    await page.locator("#editUnitProperties").click();
    await page.locator('[data-source-weapon="EF_HypeBazooka"] > summary').click();
    await expect(
      page.locator('[data-field="weapon.EF_HypeBazooka.damageComponents.shellAP"]'),
    ).toHaveValue("500");
    await expect(
      page.locator('[data-field="weapon.EF_HypeBazooka.armorPiercingIgnore"]'),
    ).toHaveValue("0.75");
    console.log("EDITOR_INCREMENTAL_SAVE_MS", Date.now() - at);
    await page.locator("#closeFormationDetail").click();
    await page.getByRole("button", { name: "取消修改并关闭", exact: true }).click();
    await page.getByRole("button", { name: "换算规则", exact: true }).click();
    await expect(page.locator('[data-field="conversion.weapons.armorPiercingIgnore"]')).toHaveValue(
      "0.5",
    );
    await expect(
      page.locator('[data-field="conversion.weapons.penetrationDamagePerCount"]'),
    ).toHaveValue("0.15");
  } finally {
    await page.close();
    if (app) await app.close();
    f.cleanup();
  }
});
