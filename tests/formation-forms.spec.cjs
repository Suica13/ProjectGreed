const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
test("V squad default and read-only form preview", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.evaluate(async () => {
    await SpriteRenderer.load();
    I18n.setLanguage("zh");
  });
  const preset = await page.evaluate(() => Formation.presets()[0]);
  expect(preset.name).toBe("V作战小队");
  expect(preset.units.map((u) => u.unitId)).toEqual([
    "PegasusClass",
    "RX_78_2",
    "RX_77_2",
    "RX_77_2",
    "FF_X7Bst",
    "FF_X7Bst",
  ]);
  expect(preset.units.slice(1).map((u) => u.preload.hangarId)).toEqual([
    "Hangar_1",
    "Hangar_1",
    "Hangar_1",
    "Hangar_2",
    "Hangar_2",
  ]);
  await page.evaluate(() => Rules.validateFormation(Formation.presets()[0].units, Infinity, 36));
  await page.locator("#openFormation").click();
  await page.locator("#openFormationPicker").click();
  await page.locator("#formationSearch").fill("FA-78-1");
  await expect(page.locator('[data-detail-unit-id="RGM_79"]')).toHaveCount(0);
  await page.locator('[data-detail-unit-id="FA_78_1"]').click();
  const before = await page.locator("#formationDetailStats").innerText();
  await page.locator("#formationDetailForms button:not(:disabled)").first().click();
  await expect(page.locator("#formationDetailKit")).toBeDisabled();
  await expect(page.locator("#formationDetailStats")).not.toHaveText(before);
  await page.screenshot({ path: ".openai/form-preview.png" });
  await page.locator("#formationDetailForms button").first().click();
  await expect(page.locator("#formationDetailKit")).toBeEnabled();
  expect(await page.evaluate(() => Formation.presets()[0])).toEqual(preset);
  expect(errors).toEqual([]);
});


test('formation name uses explicit edit and save',async({page})=>{
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await page.evaluate(()=>I18n.setLanguage('zh'));
 await page.locator('#openFormation').click();
 await page.locator('#formationUnits .formation-detail-button').first().click();
 await expect(page.locator('#formationDetailName')).toHaveAttribute('readonly','');
 const title=await page.locator('#formationDetailTitle').innerText();
 await page.locator('#editFormationUnitName').click();
 await page.locator('#formationDetailName').fill('新旗舰');
 await expect(page.locator('#formationDetailTitle')).toHaveText(title);
 await page.locator('#editFormationUnitName').click();
 await expect(page.locator('#formationDetailTitle')).toContainText('新旗舰');
 await expect(page.locator('#formationDetailName')).toHaveAttribute('readonly','');
 await page.locator('#resetFormationUnitName').click();
 await expect(page.locator('#formationDetailName')).toHaveValue('');
});
